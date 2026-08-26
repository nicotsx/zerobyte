import { db } from "~/server/db/db";
import { cryptoUtils } from "~/server/utils/crypto";
import { decryptNotificationConfig } from "~/server/modules/notifications/notification-config-secrets";
import { decryptRepositoryConfig } from "~/server/modules/repositories/repository-config-secrets";
import { decryptVolumeConfig } from "~/server/modules/volumes/volume-config-secrets";
import { encryptConfigTransferPayload } from "./envelope";
import { encodeCurrentConfigTransferPayload } from "./payload";

const createTransferRef = (prefix: string, index: number) => `${prefix}:${index + 1}`;

const getExportedRepositoryName = (name: string, shortId: string) => {
	const normalizedName = name.trim();

	return normalizedName || `Repository ${shortId}`;
};

export class OrganizationResticPasswordNotFoundError extends Error {
	constructor() {
		super("Organization Restic password not found");
	}
}

const getRequiredRef = <T>(refs: Map<T, string>, id: T, label: string) => {
	const ref = refs.get(id);

	if (!ref) {
		throw new Error(`Exported ${label} ${String(id)} not found`);
	}

	return ref;
};

export const createPassphraseProtectedOrganizationConfigExport = async (
	organizationId: string,
	exportPassphrase: string,
) => {
	const {
		resticPasswordCiphertext,
		repositories,
		volumes,
		backupSchedules,
		notificationDestinations,
		backupScheduleMirrors,
		backupScheduleNotifications,
	} = db.transaction((tx) => {
		const organization = tx.query.organization.findFirst({ where: { id: organizationId } }).sync();
		const repositories = tx.query.repositoriesTable.findMany({ where: { organizationId } }).sync();
		const volumes = tx.query.volumesTable.findMany({ where: { organizationId } }).sync();
		const backupSchedules = tx.query.backupSchedulesTable.findMany({ where: { organizationId } }).sync();
		const notificationDestinations = tx.query.notificationDestinationsTable
			.findMany({ where: { organizationId } })
			.sync();

		const scheduleIds = backupSchedules.map((schedule) => schedule.id);
		const backupScheduleMirrors = tx.query.backupScheduleMirrorsTable
			.findMany({ where: { scheduleId: { in: scheduleIds } } })
			.sync();
		const backupScheduleNotifications = tx.query.backupScheduleNotificationsTable
			.findMany({ where: { scheduleId: { in: scheduleIds } } })
			.sync();

		return {
			resticPasswordCiphertext: organization?.metadata?.resticPassword,
			repositories,
			volumes,
			backupSchedules,
			notificationDestinations,
			backupScheduleMirrors,
			backupScheduleNotifications,
		};
	});

	if (!resticPasswordCiphertext) {
		throw new OrganizationResticPasswordNotFoundError();
	}

	const resticPassword = await cryptoUtils.resolveSecret(resticPasswordCiphertext);

	const repositoryRefs = new Map(
		repositories.map((repository, index) => [repository.id, createTransferRef("repository", index)]),
	);
	const volumeRefs = new Map(volumes.map((volume, index) => [volume.id, createTransferRef("volume", index)]));
	const scheduleRefs = new Map(
		backupSchedules.map((schedule, index) => [schedule.id, createTransferRef("schedule", index)]),
	);
	const destinationRefs = new Map(
		notificationDestinations.map((destination, index) => [destination.id, createTransferRef("destination", index)]),
	);

	const [exportedRepositories, exportedVolumes, exportedNotificationDestinations] = await Promise.all([
		Promise.all(
			repositories.map(async (repository) => {
				const name = getExportedRepositoryName(repository.name, repository.shortId);
				const config = await decryptRepositoryConfig(repository.config);

				return {
					ref: getRequiredRef(repositoryRefs, repository.id, "repository"),
					name,
					config,
					compressionMode: repository.compressionMode ?? "auto",
					autoCheckEnabled: repository.autoCheckEnabled,
				};
			}),
		),
		Promise.all(
			volumes.map(async (volume) => ({
				ref: getRequiredRef(volumeRefs, volume.id, "volume"),
				name: volume.name,
				config: await decryptVolumeConfig(volume.config),
				autoRemount: volume.autoRemount,
			})),
		),
		Promise.all(
			notificationDestinations.map(async (destination) => ({
				ref: getRequiredRef(destinationRefs, destination.id, "notification destination"),
				name: destination.name,
				enabled: destination.enabled,
				config: await decryptNotificationConfig(destination.config),
			})),
		),
	]);

	const payload = encodeCurrentConfigTransferPayload({
		resticPassword,
		repositories: exportedRepositories,
		volumes: exportedVolumes,
		backupSchedules: backupSchedules.map((schedule) => ({
			ref: getRequiredRef(scheduleRefs, schedule.id, "backup schedule"),
			name: schedule.name,
			volumeRef: getRequiredRef(volumeRefs, schedule.volumeId, "volume"),
			repositoryRef: getRequiredRef(repositoryRefs, schedule.repositoryId, "repository"),
			enabled: schedule.enabled,
			cronExpression: schedule.cronExpression,
			retentionPolicy: schedule.retentionPolicy ?? null,
			excludePatterns: schedule.excludePatterns ?? [],
			excludeIfPresent: schedule.excludeIfPresent ?? [],
			includePaths: schedule.includePaths ?? [],
			includePatterns: schedule.includePatterns ?? [],
			oneFileSystem: schedule.oneFileSystem,
			customResticParams: schedule.customResticParams ?? [],
			compressionMode: schedule.compressionMode ?? null,
			backupWebhooks: schedule.backupWebhooks ?? null,
			maxRetries: schedule.maxRetries,
			retryDelay: schedule.retryDelay,
			sortOrder: schedule.sortOrder,
		})),
		notificationDestinations: exportedNotificationDestinations,
		backupScheduleMirrors: backupScheduleMirrors.map((mirror) => ({
			scheduleRef: getRequiredRef(scheduleRefs, mirror.scheduleId, "backup schedule"),
			repositoryRef: getRequiredRef(repositoryRefs, mirror.repositoryId, "repository"),
			enabled: mirror.enabled,
		})),
		backupScheduleNotifications: backupScheduleNotifications.map((notification) => ({
			scheduleRef: getRequiredRef(scheduleRefs, notification.scheduleId, "backup schedule"),
			destinationRef: getRequiredRef(destinationRefs, notification.destinationId, "notification destination"),
			notifyOnStart: notification.notifyOnStart,
			notifyOnSuccess: notification.notifyOnSuccess,
			notifyOnWarning: notification.notifyOnWarning,
			notifyOnFailure: notification.notifyOnFailure,
		})),
	});

	return encryptConfigTransferPayload(JSON.stringify(payload), exportPassphrase);
};
