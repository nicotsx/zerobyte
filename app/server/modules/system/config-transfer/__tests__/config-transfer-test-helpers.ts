import { readFile } from "node:fs/promises";
import { expect, vi } from "vitest";
import { createApp } from "~/server/app";
import { db } from "~/server/db/db";
import {
	backupScheduleMirrorsTable,
	backupScheduleNotificationsTable,
	backupSchedulesTable,
	notificationDestinationsTable,
	repositoriesTable,
	volumesTable,
	type BackupSchedule,
} from "~/server/db/schema";
import * as authHelpers from "~/server/modules/auth/helpers";
import {
	decryptNotificationConfig,
	encryptNotificationConfig,
} from "~/server/modules/notifications/notification-config-secrets";
import {
	decryptRepositoryConfig,
	encryptRepositoryConfig,
} from "~/server/modules/repositories/repository-config-secrets";
import { decryptVolumeConfig, encryptVolumeConfig } from "~/server/modules/volumes/volume-config-secrets";
import { encryptConfigTransferPayload as encryptPayload } from "../envelope";
import { generateShortId } from "~/server/utils/id";

const app = createApp();

export const configTransferFixturePassphrase = "fixture-export-passphrase-for-config-transfer-v1";

export const requestConfigExport = (
	headers: Record<string, string>,
	password = "",
	exportPassphrase = configTransferFixturePassphrase,
) => {
	return app.request("/api/v1/system/config-export", {
		method: "POST",
		headers: { ...headers, "Content-Type": "application/json" },
		body: JSON.stringify({ password, exportPassphrase }),
	});
};

export const requestConfigImport = (
	headers: Record<string, string>,
	encryptedConfig: string,
	exportPassphrase = configTransferFixturePassphrase,
) => {
	return app.request("/api/v1/system/config-import", {
		method: "POST",
		headers: { ...headers, "Content-Type": "application/json" },
		body: JSON.stringify({ encryptedConfig, exportPassphrase }),
	});
};

export const loadConfigTransferPayloadFixture = async () => {
	return JSON.parse(
		await readFile(new URL("../../__fixtures__/config-transfer/v1-full.payload.json", import.meta.url), "utf8"),
	);
};

export const loadEncryptedConfigTransferFixture = async () => {
	return (await readFile(new URL("../../__fixtures__/config-transfer/v1-full.zbex", import.meta.url), "utf8")).trim();
};

export const encryptConfigTransferPayload = async (payload: unknown) => {
	return await encryptPayload(JSON.stringify(payload), configTransferFixturePassphrase);
};

export const allowConfigExportPassword = () => {
	vi.spyOn(authHelpers, "userHasPassword").mockResolvedValueOnce(true);
	vi.spyOn(authHelpers, "verifyUserPassword").mockResolvedValueOnce(true);
};

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

export const createCompleteDurableConfiguration = async (organizationId: string) => {
	const [volume] = await db
		.insert(volumesTable)
		.values({
			shortId: generateShortId(),
			name: "Parity Volume",
			type: "sftp",
			config: await encryptVolumeConfig({
				backend: "sftp",
				host: "sftp.example.test",
				port: 2222,
				username: "parity-user",
				password: "parity-volume-password",
				privateKey: "parity-volume-private-key",
				path: "/source",
				readOnly: true,
				skipHostKeyCheck: false,
				knownHosts: "sftp.example.test ssh-ed25519 fixture-key",
				allowLegacySshRsa: false,
				allowUnsafeSymlinkTargets: true,
			}),
			status: "mounted",
			lastError: "stale volume error",
			lastHealthCheck: 111,
			autoRemount: false,
			organizationId,
		})
		.returning();
	const [primaryRepository] = await db
		.insert(repositoriesTable)
		.values({
			id: crypto.randomUUID(),
			shortId: generateShortId(),
			name: "Parity Primary Repository",
			type: "s3",
			config: await encryptRepositoryConfig({
				backend: "s3",
				endpoint: "https://s3.example.test",
				bucket: "parity-primary",
				accessKeyId: "parity-access-key",
				secretAccessKey: "parity-secret-key",
				customPassword: "parity-repository-password",
				cacert: "parity-ca-cert",
				insecureTls: true,
				isExistingRepository: true,
				uploadLimit: { enabled: true, value: 123, unit: "Mbps" },
				downloadLimit: { enabled: true, value: 45, unit: "Kbps" },
			}),
			compressionMode: "max",
			status: "error",
			lastChecked: 222,
			lastError: "stale repository error",
			autoCheckEnabled: false,
			uploadLimitEnabled: true,
			uploadLimitValue: 123,
			uploadLimitUnit: "Mbps",
			downloadLimitEnabled: true,
			downloadLimitValue: 45,
			downloadLimitUnit: "Kbps",
			organizationId,
		})
		.returning();
	const [mirrorRepository] = await db
		.insert(repositoriesTable)
		.values({
			id: crypto.randomUUID(),
			shortId: generateShortId(),
			name: "Parity Mirror Repository",
			type: "rclone",
			config: await encryptRepositoryConfig({
				backend: "rclone",
				remote: "parity-mirror",
				path: "/copy",
				customPassword: "parity-mirror-password",
				uploadLimit: { enabled: false, value: 7, unit: "Gbps" },
				downloadLimit: { enabled: true, value: 8, unit: "Mbps" },
			}),
			compressionMode: "off",
			status: "healthy",
			uploadLimitEnabled: false,
			uploadLimitValue: 7,
			uploadLimitUnit: "Gbps",
			downloadLimitEnabled: true,
			downloadLimitValue: 8,
			downloadLimitUnit: "Mbps",
			organizationId,
		})
		.returning();
	const [schedule] = await db
		.insert(backupSchedulesTable)
		.values({
			shortId: generateShortId(),
			name: "Parity Schedule",
			volumeId: volume.id,
			repositoryId: primaryRepository.id,
			enabled: true,
			cronExpression: "*/15 * * * *",
			retentionPolicy: {
				keepLast: 11,
				keepHourly: 12,
				keepDaily: 13,
				keepWeekly: 14,
				keepMonthly: 15,
				keepYearly: 16,
				keepWithinDuration: "90d",
			},
			excludePatterns: ["*.tmp", "cache/**"],
			excludeIfPresent: [".nobackup", ".skip-backup"],
			includePaths: ["/Documents", "/Pictures"],
			includePatterns: ["**/*.md", "**/*.jpg"],
			lastBackupAt: 333,
			lastBackupStatus: "warning",
			lastBackupError: "stale schedule error",
			nextBackupAt: 444,
			oneFileSystem: true,
			customResticParams: ["--pack-size 64", "--ignore-inode"],
			compressionMode: "off",
			backupWebhooks: {
				pre: {
					url: "https://hooks.example.test/pre",
					headers: ["Authorization: Bearer pre-token"],
					body: '{"phase":"pre"}',
					insecureTls: true,
				},
				post: { url: "https://hooks.example.test/post", insecureTls: false },
			},
			sortOrder: 17,
			failureRetryCount: 5,
			maxRetries: 6,
			retryDelay: 75_000,
			organizationId,
		})
		.returning();
	const [destination] = await db
		.insert(notificationDestinationsTable)
		.values({
			name: "Parity Notification",
			enabled: false,
			type: "slack",
			config: await encryptNotificationConfig({
				type: "slack",
				webhookUrl: "https://hooks.slack.example.test/parity",
				username: "Zerobyte",
				iconEmoji: ":floppy_disk:",
			}),
			organizationId,
		})
		.returning();

	await db.insert(backupScheduleMirrorsTable).values({
		scheduleId: schedule.id,
		repositoryId: mirrorRepository.id,
		enabled: false,
		lastCopyAt: 555,
		lastCopyStatus: "in_progress",
		lastCopyError: "stale copy error",
	});
	await db.insert(backupScheduleNotificationsTable).values({
		scheduleId: schedule.id,
		destinationId: destination.id,
		notifyOnStart: true,
		notifyOnSuccess: false,
		notifyOnWarning: true,
		notifyOnFailure: false,
	});
};

export const loadNormalizedConfigState = async (organizationId: string) => {
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
