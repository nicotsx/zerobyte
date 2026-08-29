import { db } from "~/server/db/db";
import {
	backupScheduleMirrorsTable,
	backupScheduleNotificationsTable,
	backupSchedulesTable,
	notificationDestinationsTable,
	repositoriesTable,
	volumesTable,
} from "~/server/db/schema";
import { encryptNotificationConfig } from "~/server/modules/notifications/notification-config-secrets";
import { encryptRepositoryConfig } from "~/server/modules/repositories/repository-config-secrets";
import { encryptVolumeConfig } from "~/server/modules/volumes/volume-config-secrets";
import { generateShortId } from "~/server/utils/id";

export const seedConfig = async (organizationId: string) => {
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

	return { schedule };
};
