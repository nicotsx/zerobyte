import { expect } from "vitest";
import { db } from "~/server/db/db";
import type { BackupSchedule } from "~/server/db/schema";
import { decryptNotificationConfig } from "~/server/modules/notifications/notification-config-secrets";
import { decryptRepositoryConfig } from "~/server/modules/repositories/repository-config-secrets";
import { decryptVolumeConfig } from "~/server/modules/volumes/volume-config-secrets";

const durableAndRuntimeFields = {
	repository: {
		durable: [
			"name",
			"type",
			"config",
			"compressionMode",
			"autoCheckEnabled",
			"uploadLimitEnabled",
			"uploadLimitValue",
			"uploadLimitUnit",
			"downloadLimitEnabled",
			"downloadLimitValue",
			"downloadLimitUnit",
		],
		runtime: [
			"id",
			"shortId",
			"provisioningId",
			"status",
			"lastChecked",
			"lastError",
			"doctorResult",
			"stats",
			"statsUpdatedAt",
			"createdAt",
			"updatedAt",
			"organizationId",
		],
	},
	volume: {
		durable: ["name", "type", "config", "autoRemount"],
		runtime: [
			"agentId",
			"id",
			"shortId",
			"provisioningId",
			"status",
			"lastError",
			"lastHealthCheck",
			"createdAt",
			"updatedAt",
			"organizationId",
		],
	},
	backupSchedule: {
		durable: [
			"name",
			"volumeId",
			"repositoryId",
			"enabled",
			"cronExpression",
			"retentionPolicy",
			"excludePatterns",
			"excludeIfPresent",
			"includePaths",
			"includePatterns",
			"oneFileSystem",
			"customResticParams",
			"compressionMode",
			"backupWebhooks",
			"sortOrder",
			"maxRetries",
			"retryDelay",
		],
		runtime: [
			"id",
			"shortId",
			"lastBackupAt",
			"lastBackupStatus",
			"lastBackupError",
			"nextBackupAt",
			"failureRetryCount",
			"createdAt",
			"updatedAt",
			"organizationId",
		],
	},
	notificationDestination: {
		durable: ["name", "enabled", "type", "config"],
		runtime: ["id", "status", "lastChecked", "lastError", "createdAt", "updatedAt", "organizationId"],
	},
	backupScheduleMirror: {
		durable: ["scheduleId", "repositoryId", "enabled"],
		runtime: ["id", "lastCopyAt", "lastCopyStatus", "lastCopyError", "createdAt"],
	},
	backupScheduleNotification: {
		durable: [
			"scheduleId",
			"destinationId",
			"notifyOnStart",
			"notifyOnSuccess",
			"notifyOnWarning",
			"notifyOnFailure",
		],
		runtime: ["createdAt"],
	},
} as const;

type DurableBackupScheduleField = (typeof durableAndRuntimeFields.backupSchedule.durable)[number];
type NormalizedBackupSchedule = Omit<Pick<BackupSchedule, DurableBackupScheduleField>, "volumeId" | "repositoryId"> & {
	volumeName: string;
	repositoryName: string;
};

const expectKnownConfigFields = (
	record: object,
	fields: { durable: readonly string[]; runtime: readonly string[] },
) => {
	expect(Object.keys(record).sort()).toEqual([...fields.durable, ...fields.runtime].sort());
};

const sortConfigRecords = <T>(items: T[]) =>
	[...items].sort((first, second) => JSON.stringify(first).localeCompare(JSON.stringify(second)));

const getMappedName = <T>(namesById: Map<T, string>, id: T, label: string) => {
	const name = namesById.get(id);
	if (!name) {
		throw new Error(`Expected ${label} ${String(id)} to be present`);
	}
	return name;
};

export const loadConfigState = async (organizationId: string) => {
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
					db.query.backupScheduleMirrorsTable.findMany({
						where: { scheduleId: { in: scheduleIds } },
					}),
					db.query.backupScheduleNotificationsTable.findMany({
						where: { scheduleId: { in: scheduleIds } },
					}),
				]);

	for (const repository of repositories) expectKnownConfigFields(repository, durableAndRuntimeFields.repository);
	for (const volume of volumes) expectKnownConfigFields(volume, durableAndRuntimeFields.volume);
	for (const schedule of backupSchedules) expectKnownConfigFields(schedule, durableAndRuntimeFields.backupSchedule);
	for (const destination of notificationDestinations)
		expectKnownConfigFields(destination, durableAndRuntimeFields.notificationDestination);
	for (const mirror of backupScheduleMirrors)
		expectKnownConfigFields(mirror, durableAndRuntimeFields.backupScheduleMirror);
	for (const notification of backupScheduleNotifications)
		expectKnownConfigFields(notification, durableAndRuntimeFields.backupScheduleNotification);

	const volumeNamesById = new Map(volumes.map((volume) => [volume.id, volume.name]));
	const repositoryNamesById = new Map(repositories.map((repository) => [repository.id, repository.name]));
	const scheduleNamesById = new Map(backupSchedules.map((schedule) => [schedule.id, schedule.name]));
	const destinationNamesById = new Map(
		notificationDestinations.map((destination) => [destination.id, destination.name]),
	);

	return {
		repositories: sortConfigRecords(
			await Promise.all(
				repositories.map(async (repository) => ({
					name: repository.name,
					type: repository.type,
					config: await decryptRepositoryConfig(repository.config),
					compressionMode: repository.compressionMode,
					autoCheckEnabled: repository.autoCheckEnabled,
					uploadLimitEnabled: repository.uploadLimitEnabled,
					uploadLimitValue: repository.uploadLimitValue,
					uploadLimitUnit: repository.uploadLimitUnit,
					downloadLimitEnabled: repository.downloadLimitEnabled,
					downloadLimitValue: repository.downloadLimitValue,
					downloadLimitUnit: repository.downloadLimitUnit,
				})),
			),
		),
		volumes: sortConfigRecords(
			await Promise.all(
				volumes.map(async (volume) => ({
					name: volume.name,
					type: volume.type,
					config: await decryptVolumeConfig(volume.config),
					autoRemount: volume.autoRemount,
				})),
			),
		),
		backupSchedules: sortConfigRecords(
			backupSchedules.map((schedule): NormalizedBackupSchedule => ({
				name: schedule.name,
				enabled: schedule.enabled,
				cronExpression: schedule.cronExpression,
				retentionPolicy: schedule.retentionPolicy,
				excludePatterns: schedule.excludePatterns,
				excludeIfPresent: schedule.excludeIfPresent,
				includePaths: schedule.includePaths,
				includePatterns: schedule.includePatterns,
				oneFileSystem: schedule.oneFileSystem,
				customResticParams: schedule.customResticParams,
				compressionMode: schedule.compressionMode,
				backupWebhooks: schedule.backupWebhooks,
				sortOrder: schedule.sortOrder,
				maxRetries: schedule.maxRetries,
				retryDelay: schedule.retryDelay,
				volumeName: getMappedName(volumeNamesById, schedule.volumeId, "volume"),
				repositoryName: getMappedName(repositoryNamesById, schedule.repositoryId, "repository"),
			})),
		),
		notificationDestinations: sortConfigRecords(
			await Promise.all(
				notificationDestinations.map(async (destination) => ({
					name: destination.name,
					enabled: destination.enabled,
					type: destination.type,
					config: await decryptNotificationConfig(destination.config),
				})),
			),
		),
		backupScheduleMirrors: sortConfigRecords(
			backupScheduleMirrors.map((mirror) => ({
				scheduleName: getMappedName(scheduleNamesById, mirror.scheduleId, "backup schedule"),
				repositoryName: getMappedName(repositoryNamesById, mirror.repositoryId, "repository"),
				enabled: mirror.enabled,
			})),
		),
		backupScheduleNotifications: sortConfigRecords(
			backupScheduleNotifications.map((notification) => ({
				scheduleName: getMappedName(scheduleNamesById, notification.scheduleId, "backup schedule"),
				destinationName: getMappedName(
					destinationNamesById,
					notification.destinationId,
					"notification destination",
				),
				notifyOnStart: notification.notifyOnStart,
				notifyOnSuccess: notification.notifyOnSuccess,
				notifyOnWarning: notification.notifyOnWarning,
				notifyOnFailure: notification.notifyOnFailure,
			})),
		),
	};
};
