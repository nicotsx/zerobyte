import { BANDWIDTH_UNITS, COMPRESSION_MODES, repositoryConfigSchema } from "@zerobyte/core/restic";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { notificationConfigSchema } from "~/schemas/notifications";
import { volumeConfigSchema } from "~/schemas/volumes";
import { db } from "~/server/db/db";
import {
	backupScheduleMirrorsTable,
	backupScheduleNotificationsTable,
	backupSchedulesTable,
	notificationDestinationsTable,
	organization,
	repositoriesTable,
	usersTable,
	volumesTable,
} from "~/server/db/schema";
import { calculateNextRun } from "~/server/modules/backups/backup.helpers";
import {
	decryptNotificationConfig,
	encryptNotificationConfig,
} from "~/server/modules/notifications/notification-config-secrets";
import {
	decryptRepositoryConfig,
	encryptRepositoryConfig,
} from "~/server/modules/repositories/repository-config-secrets";
import { decryptVolumeConfig, encryptVolumeConfig } from "~/server/modules/volumes/volume-config-secrets";
import { cryptoUtils } from "~/server/utils/crypto";
import { generateShortId } from "~/server/utils/id";

const transferRefSchema = z.string().min(1);

const retentionPolicySchema = z.object({
	keepLast: z.number().optional(),
	keepHourly: z.number().optional(),
	keepDaily: z.number().optional(),
	keepWeekly: z.number().optional(),
	keepMonthly: z.number().optional(),
	keepYearly: z.number().optional(),
	keepWithinDuration: z.string().optional(),
});

const bandwidthLimitSchema = z.object({
	enabled: z.boolean(),
	value: z.number(),
	unit: z.enum(BANDWIDTH_UNITS),
});

const exportedRepositorySchema = z.object({
	ref: transferRefSchema,
	name: z.string().min(1),
	config: repositoryConfigSchema,
	compressionMode: z.enum(COMPRESSION_MODES),
	uploadLimit: bandwidthLimitSchema,
	downloadLimit: bandwidthLimitSchema,
});

const exportedVolumeSchema = z.object({
	ref: transferRefSchema,
	name: z.string().min(1),
	config: volumeConfigSchema,
	autoRemount: z.boolean(),
});

const exportedBackupScheduleSchema = z.object({
	ref: transferRefSchema,
	name: z.string().min(1),
	volumeRef: transferRefSchema,
	repositoryRef: transferRefSchema,
	enabled: z.boolean(),
	cronExpression: z.string(),
	retentionPolicy: retentionPolicySchema.nullable(),
	excludePatterns: z.array(z.string()),
	excludeIfPresent: z.array(z.string()),
	includePaths: z.array(z.string()),
	includePatterns: z.array(z.string()),
	oneFileSystem: z.boolean(),
	customResticParams: z.array(z.string()),
	maxRetries: z.number().int().min(0),
	retryDelay: z.number().int().min(0),
	sortOrder: z.number().int(),
});

const exportedNotificationDestinationSchema = z.object({
	ref: transferRefSchema,
	name: z.string().min(1),
	enabled: z.boolean(),
	config: notificationConfigSchema,
});

const exportedBackupScheduleMirrorSchema = z.object({
	scheduleRef: transferRefSchema,
	repositoryRef: transferRefSchema,
	enabled: z.boolean(),
});

const exportedBackupScheduleNotificationSchema = z.object({
	scheduleRef: transferRefSchema,
	destinationRef: transferRefSchema,
	notifyOnStart: z.boolean(),
	notifyOnSuccess: z.boolean(),
	notifyOnWarning: z.boolean(),
	notifyOnFailure: z.boolean(),
});

const configTransferPayloadV2Schema = z.object({
	version: z.literal(2),
	repositories: z.array(exportedRepositorySchema),
	volumes: z.array(exportedVolumeSchema),
	backupSchedules: z.array(exportedBackupScheduleSchema),
	notificationDestinations: z.array(exportedNotificationDestinationSchema),
	backupScheduleMirrors: z.array(exportedBackupScheduleMirrorSchema),
	backupScheduleNotifications: z.array(exportedBackupScheduleNotificationSchema),
});

const configTransferPayloadSchema = z.discriminatedUnion("version", [configTransferPayloadV2Schema]);

const configTransferPrefix = "zbcfg:";

const createTransferRef = (prefix: string, index: number) => `${prefix}:${index + 1}`;

const decodeEncryptedPayload = async (encryptedConfig: string, resticPassword: string) => {
	const decryptedPayload = await cryptoUtils.decryptWithSecret(encryptedConfig, {
		prefix: configTransferPrefix,
		secret: resticPassword,
	});
	const parsed = JSON.parse(decryptedPayload) as unknown;

	return configTransferPayloadSchema.parse(parsed);
};

export const isOrganizationConfigEmpty = async (organizationId: string) => {
	const [repository, volume, schedule, destination] = await Promise.all([
		db.query.repositoriesTable.findFirst({ where: { organizationId }, columns: { id: true } }),
		db.query.volumesTable.findFirst({ where: { organizationId }, columns: { id: true } }),
		db.query.backupSchedulesTable.findFirst({ where: { organizationId }, columns: { id: true } }),
		db.query.notificationDestinationsTable.findFirst({ where: { organizationId }, columns: { id: true } }),
	]);

	return !repository && !volume && !schedule && !destination;
};

export const createEncryptedOrganizationConfigExport = async (organizationId: string, resticPassword: string) => {
	const [repositories, volumes, backupSchedules, notificationDestinations] = await Promise.all([
		db.query.repositoriesTable.findMany({ where: { organizationId } }),
		db.query.volumesTable.findMany({ where: { organizationId } }),
		db.query.backupSchedulesTable.findMany({ where: { organizationId } }),
		db.query.notificationDestinationsTable.findMany({ where: { organizationId } }),
	]);

	const scheduleIds = backupSchedules.map((schedule) => schedule.id);

	const [backupScheduleMirrors, backupScheduleNotifications] =
		scheduleIds.length === 0
			? [[], []]
			: await Promise.all([
					db.query.backupScheduleMirrorsTable.findMany({ where: { scheduleId: { in: scheduleIds } } }),
					db.query.backupScheduleNotificationsTable.findMany({ where: { scheduleId: { in: scheduleIds } } }),
				]);

	const [decryptedRepositories, decryptedVolumes, decryptedNotificationDestinations] = await Promise.all([
		Promise.all(
			repositories.map(async (repository) => ({
				...repository,
				config: await decryptRepositoryConfig(repository.config),
			})),
		),
		Promise.all(
			volumes.map(async (volume) => ({
				...volume,
				config: await decryptVolumeConfig(volume.config),
			})),
		),
		Promise.all(
			notificationDestinations.map(async (destination) => ({
				...destination,
				config: await decryptNotificationConfig(destination.config),
			})),
		),
	]);

	const repositoryRefMap = new Map<string, string>();
	const volumeRefMap = new Map<number, string>();
	const scheduleRefMap = new Map<number, string>();
	const destinationRefMap = new Map<number, string>();

	const exportedRepositories = decryptedRepositories.map((repository, index) => {
		const ref = createTransferRef("repository", index);
		repositoryRefMap.set(repository.id, ref);

		return {
			ref,
			name: repository.name,
			config: repository.config,
			compressionMode: repository.compressionMode ?? "auto",
			uploadLimit: {
				enabled: repository.uploadLimitEnabled,
				value: repository.uploadLimitValue,
				unit: repository.uploadLimitUnit,
			},
			downloadLimit: {
				enabled: repository.downloadLimitEnabled,
				value: repository.downloadLimitValue,
				unit: repository.downloadLimitUnit,
			},
		};
	});

	const exportedVolumes = decryptedVolumes.map((volume, index) => {
		const ref = createTransferRef("volume", index);
		volumeRefMap.set(volume.id, ref);

		return {
			ref,
			name: volume.name,
			config: volume.config,
			autoRemount: volume.autoRemount,
		};
	});

	const exportedSchedules = backupSchedules.map((schedule, index) => {
		const volumeRef = volumeRefMap.get(schedule.volumeId);
		const repositoryRef = repositoryRefMap.get(schedule.repositoryId);

		if (!volumeRef) {
			throw new Error(`Exported volume ${schedule.volumeId} not found`);
		}

		if (!repositoryRef) {
			throw new Error(`Exported repository ${schedule.repositoryId} not found`);
		}

		const ref = createTransferRef("schedule", index);
		scheduleRefMap.set(schedule.id, ref);

		return {
			ref,
			name: schedule.name,
			volumeRef,
			repositoryRef,
			enabled: schedule.enabled,
			cronExpression: schedule.cronExpression,
			retentionPolicy: schedule.retentionPolicy ?? null,
			excludePatterns: schedule.excludePatterns ?? [],
			excludeIfPresent: schedule.excludeIfPresent ?? [],
			includePaths: schedule.includePaths ?? [],
			includePatterns: schedule.includePatterns ?? [],
			oneFileSystem: schedule.oneFileSystem,
			customResticParams: schedule.customResticParams ?? [],
			maxRetries: schedule.maxRetries,
			retryDelay: schedule.retryDelay,
			sortOrder: schedule.sortOrder,
		};
	});

	const exportedDestinations = decryptedNotificationDestinations.map((destination, index) => {
		const ref = createTransferRef("destination", index);
		destinationRefMap.set(destination.id, ref);

		return {
			ref,
			name: destination.name,
			enabled: destination.enabled,
			config: destination.config,
		};
	});

	const exportedMirrors = backupScheduleMirrors.map((mirror) => {
		const scheduleRef = scheduleRefMap.get(mirror.scheduleId);
		const repositoryRef = repositoryRefMap.get(mirror.repositoryId);

		if (!scheduleRef) {
			throw new Error(`Exported backup schedule ${mirror.scheduleId} not found`);
		}

		if (!repositoryRef) {
			throw new Error(`Exported repository ${mirror.repositoryId} not found`);
		}

		return {
			scheduleRef,
			repositoryRef,
			enabled: mirror.enabled,
		};
	});

	const exportedNotifications = backupScheduleNotifications.map((notification) => {
		const scheduleRef = scheduleRefMap.get(notification.scheduleId);
		const destinationRef = destinationRefMap.get(notification.destinationId);

		if (!scheduleRef) {
			throw new Error(`Exported backup schedule ${notification.scheduleId} not found`);
		}

		if (!destinationRef) {
			throw new Error(`Exported notification destination ${notification.destinationId} not found`);
		}

		return {
			scheduleRef,
			destinationRef,
			notifyOnStart: notification.notifyOnStart,
			notifyOnSuccess: notification.notifyOnSuccess,
			notifyOnWarning: notification.notifyOnWarning,
			notifyOnFailure: notification.notifyOnFailure,
		};
	});

	const payload = configTransferPayloadV2Schema.parse({
		version: 2,
		repositories: exportedRepositories,
		volumes: exportedVolumes,
		backupSchedules: exportedSchedules,
		notificationDestinations: exportedDestinations,
		backupScheduleMirrors: exportedMirrors,
		backupScheduleNotifications: exportedNotifications,
	});

	return await cryptoUtils.encryptWithSecret(JSON.stringify(payload), {
		prefix: configTransferPrefix,
		secret: resticPassword,
	});
};

export const importEncryptedOrganizationConfig = async (
	organizationId: string,
	userId: string,
	encryptedConfig: string,
	resticPassword: string,
) => {
	const parsedPayload = await decodeEncryptedPayload(encryptedConfig, resticPassword);

	const [encryptedRepositories, encryptedVolumes, encryptedNotificationDestinations] = await Promise.all([
		Promise.all(
			parsedPayload.repositories.map(async (repository) => ({
				...repository,
				config: await encryptRepositoryConfig(repository.config),
			})),
		),
		Promise.all(
			parsedPayload.volumes.map(async (volume) => ({
				...volume,
				config: await encryptVolumeConfig(volume.config),
			})),
		),
		Promise.all(
			parsedPayload.notificationDestinations.map(async (destination) => ({
				...destination,
				config: await encryptNotificationConfig(destination.config),
			})),
		),
	]);

	const sealedResticPassword = await cryptoUtils.sealSecret(resticPassword);

	db.transaction((tx) => {
		const org = tx.query.organization.findFirst({ where: { id: organizationId }, columns: { metadata: true } }).sync();
		const repositoryIdMap = new Map<string, string>();
		const volumeIdMap = new Map<string, number>();
		const scheduleIdMap = new Map<string, number>();
		const destinationIdMap = new Map<string, number>();

		if (!org) {
			throw new Error("Organization not found");
		}

		for (const repository of encryptedRepositories) {
			const importedRepositoryId = Bun.randomUUIDv7();

			tx.insert(repositoriesTable)
				.values({
					id: importedRepositoryId,
					shortId: generateShortId(),
					name: repository.name,
					type: repository.config.backend,
					config: repository.config,
					compressionMode: repository.compressionMode,
					status: "unknown",
					lastChecked: null,
					lastError: null,
					doctorResult: null,
					stats: null,
					statsUpdatedAt: null,
					uploadLimitEnabled: repository.uploadLimit.enabled,
					uploadLimitValue: repository.uploadLimit.value,
					uploadLimitUnit: repository.uploadLimit.unit,
					downloadLimitEnabled: repository.downloadLimit.enabled,
					downloadLimitValue: repository.downloadLimit.value,
					downloadLimitUnit: repository.downloadLimit.unit,
					organizationId,
				})
				.run();

			repositoryIdMap.set(repository.ref, importedRepositoryId);
		}

		for (const volume of encryptedVolumes) {
			const importedVolumeShortId = generateShortId();

			tx.insert(volumesTable)
				.values({
					shortId: importedVolumeShortId,
					name: volume.name,
					type: volume.config.backend,
					status: "unmounted",
					lastError: null,
					config: volume.config,
					autoRemount: volume.autoRemount,
					organizationId,
				})
				.run();

			const insertedVolume = tx.query.volumesTable
				.findFirst({
					where: {
						AND: [{ shortId: { eq: importedVolumeShortId } }, { organizationId }],
					},
					columns: { id: true },
				})
				.sync();

			if (!insertedVolume) {
				throw new Error(`Imported volume ${volume.ref} not found`);
			}

			volumeIdMap.set(volume.ref, insertedVolume.id);
		}

		for (const schedule of parsedPayload.backupSchedules) {
			const mappedVolumeId = volumeIdMap.get(schedule.volumeRef);
			const mappedRepositoryId = repositoryIdMap.get(schedule.repositoryRef);

			if (!mappedVolumeId) {
				throw new Error(`Imported volume ${schedule.volumeRef} not found`);
			}

			if (!mappedRepositoryId) {
				throw new Error(`Imported repository ${schedule.repositoryRef} not found`);
			}

			const importedScheduleShortId = generateShortId();

			tx.insert(backupSchedulesTable)
				.values({
					shortId: importedScheduleShortId,
					name: schedule.name,
					volumeId: mappedVolumeId,
					repositoryId: mappedRepositoryId,
					enabled: schedule.enabled,
					cronExpression: schedule.cronExpression,
					retentionPolicy: schedule.retentionPolicy,
					excludePatterns: schedule.excludePatterns,
					excludeIfPresent: schedule.excludeIfPresent,
					includePaths: schedule.includePaths,
					includePatterns: schedule.includePatterns,
					lastBackupAt: null,
					lastBackupStatus: null,
					lastBackupError: null,
					nextBackupAt: schedule.cronExpression ? calculateNextRun(schedule.cronExpression) : null,
					oneFileSystem: schedule.oneFileSystem,
					customResticParams: schedule.customResticParams,
					sortOrder: schedule.sortOrder,
					failureRetryCount: 0,
					maxRetries: schedule.maxRetries,
					retryDelay: schedule.retryDelay,
					organizationId,
				})
				.run();

			const insertedSchedule = tx.query.backupSchedulesTable
				.findFirst({
					where: {
						AND: [{ shortId: { eq: importedScheduleShortId } }, { organizationId }],
					},
					columns: { id: true },
				})
				.sync();

			if (!insertedSchedule) {
				throw new Error(`Imported backup schedule ${schedule.ref} not found`);
			}

			scheduleIdMap.set(schedule.ref, insertedSchedule.id);
		}

		for (const destination of encryptedNotificationDestinations) {
			tx.insert(notificationDestinationsTable)
				.values({
					name: destination.name,
					enabled: destination.enabled,
					type: destination.config.type,
					config: destination.config,
					organizationId,
				})
				.run();

			const insertedDestination = tx.query.notificationDestinationsTable
				.findFirst({
					where: { organizationId },
					orderBy: { id: "desc" },
					columns: { id: true },
				})
				.sync();

			if (!insertedDestination) {
				throw new Error(`Imported notification destination ${destination.ref} not found`);
			}

			destinationIdMap.set(destination.ref, insertedDestination.id);
		}

		for (const mirror of parsedPayload.backupScheduleMirrors) {
			const mappedScheduleId = scheduleIdMap.get(mirror.scheduleRef);
			const mappedRepositoryId = repositoryIdMap.get(mirror.repositoryRef);

			if (!mappedScheduleId) {
				throw new Error(`Imported backup schedule ${mirror.scheduleRef} not found`);
			}

			if (!mappedRepositoryId) {
				throw new Error(`Imported repository ${mirror.repositoryRef} not found`);
			}

			tx.insert(backupScheduleMirrorsTable)
				.values({
					scheduleId: mappedScheduleId,
					repositoryId: mappedRepositoryId,
					enabled: mirror.enabled,
					lastCopyAt: null,
					lastCopyStatus: null,
					lastCopyError: null,
				})
				.run();
		}

		for (const notification of parsedPayload.backupScheduleNotifications) {
			const mappedScheduleId = scheduleIdMap.get(notification.scheduleRef);
			const mappedDestinationId = destinationIdMap.get(notification.destinationRef);

			if (!mappedScheduleId) {
				throw new Error(`Imported backup schedule ${notification.scheduleRef} not found`);
			}

			if (!mappedDestinationId) {
				throw new Error(`Imported notification destination ${notification.destinationRef} not found`);
			}

			tx.insert(backupScheduleNotificationsTable)
				.values({
					scheduleId: mappedScheduleId,
					destinationId: mappedDestinationId,
					notifyOnStart: notification.notifyOnStart,
					notifyOnSuccess: notification.notifyOnSuccess,
					notifyOnWarning: notification.notifyOnWarning,
					notifyOnFailure: notification.notifyOnFailure,
				})
				.run();
		}

		tx.update(organization)
			.set({ metadata: { ...(org.metadata ?? {}), resticPassword: sealedResticPassword } })
			.where(eq(organization.id, organizationId))
			.run();

		tx.update(usersTable).set({ hasDownloadedResticPassword: true }).where(eq(usersTable.id, userId)).run();
	});

	return {
		repositories: parsedPayload.repositories.length,
		volumes: parsedPayload.volumes.length,
		backupSchedules: parsedPayload.backupSchedules.length,
		notificationDestinations: parsedPayload.notificationDestinations.length,
		backupScheduleMirrors: parsedPayload.backupScheduleMirrors.length,
		backupScheduleNotifications: parsedPayload.backupScheduleNotifications.length,
	};
};
