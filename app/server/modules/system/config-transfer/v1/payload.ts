import { z } from "zod";

const transferRefSchema = z.string().min(1);
const portSchema = z.number().int().min(1).max(65535);

const bandwidthLimitSchema = z
	.object({
		enabled: z.boolean(),
		value: z.number().positive(),
		unit: z.enum(["Kbps", "Mbps", "Gbps"]),
	})
	.strict();

const repositoryConfigBase = {
	isExistingRepository: z.boolean().optional(),
	customPassword: z.string().optional(),
	cacert: z.string().optional(),
	insecureTls: z.boolean().optional(),
	uploadLimit: bandwidthLimitSchema.optional(),
	downloadLimit: bandwidthLimitSchema.optional(),
};

const repositoryConfigSchema = z.discriminatedUnion("backend", [
	z
		.object({
			backend: z.literal("s3"),
			endpoint: z.string().min(1),
			bucket: z.string().min(1),
			accessKeyId: z.string().min(1),
			secretAccessKey: z.string().min(1),
			...repositoryConfigBase,
		})
		.strict(),
	z
		.object({
			backend: z.literal("r2"),
			endpoint: z.string().min(1),
			bucket: z.string().min(1),
			accessKeyId: z.string().min(1),
			secretAccessKey: z.string().min(1),
			...repositoryConfigBase,
		})
		.strict(),
	z
		.object({
			backend: z.literal("local"),
			path: z.string().min(1),
			...repositoryConfigBase,
		})
		.strict(),
	z
		.object({
			backend: z.literal("gcs"),
			bucket: z.string().min(1),
			projectId: z.string().min(1),
			credentialsJson: z.string().min(1),
			...repositoryConfigBase,
		})
		.strict(),
	z
		.object({
			backend: z.literal("azure"),
			container: z.string().min(1),
			accountName: z.string().min(1),
			accountKey: z.string().min(1),
			endpointSuffix: z.string().optional(),
			...repositoryConfigBase,
		})
		.strict(),
	z
		.object({
			backend: z.literal("rclone"),
			remote: z.string().min(1),
			path: z.string().min(1),
			...repositoryConfigBase,
		})
		.strict(),
	z
		.object({
			backend: z.literal("rest"),
			url: z.string().min(1),
			username: z.string().optional(),
			password: z.string().optional(),
			path: z.string().optional(),
			...repositoryConfigBase,
		})
		.strict(),
	z
		.object({
			backend: z.literal("sftp"),
			host: z.string().min(1),
			port: portSchema,
			user: z.string().min(1),
			path: z.string().min(1),
			privateKey: z.string().min(1),
			skipHostKeyCheck: z.boolean(),
			knownHosts: z.string().optional(),
			allowLegacySshRsa: z.boolean(),
			...repositoryConfigBase,
		})
		.strict(),
]);

const volumeConfigSchema = z
	.discriminatedUnion("backend", [
		z
			.object({
				backend: z.literal("nfs"),
				server: z.string().min(1),
				exportPath: z.string().min(1),
				port: portSchema,
				version: z.enum(["3", "4", "4.1"]),
				readOnly: z.boolean().optional(),
			})
			.strict(),
		z
			.object({
				backend: z.literal("smb"),
				server: z.string().min(1),
				share: z.string().min(1),
				username: z.string().optional(),
				password: z.string().optional(),
				guest: z.boolean().optional(),
				mapToContainerUidGid: z.boolean(),
				vers: z.enum(["1.0", "2.0", "2.1", "3.0", "auto"]),
				domain: z.string().optional(),
				port: portSchema,
				readOnly: z.boolean().optional(),
			})
			.strict(),
		z
			.object({
				backend: z.literal("directory"),
				path: z.string().min(1),
				readOnly: z.literal(false).optional(),
			})
			.strict(),
		z
			.object({
				backend: z.literal("webdav"),
				server: z.string().min(1),
				path: z.string().min(1),
				username: z.string().optional(),
				password: z.string().optional(),
				port: portSchema,
				readOnly: z.boolean().optional(),
				ssl: z.boolean().optional(),
			})
			.strict(),
		z
			.object({
				backend: z.literal("rclone"),
				remote: z.string().min(1),
				path: z.string().min(1),
				readOnly: z.boolean().optional(),
			})
			.strict(),
		z
			.object({
				backend: z.literal("sftp"),
				host: z.string().min(1),
				port: portSchema,
				username: z.string().min(1),
				password: z.string().optional(),
				privateKey: z.string().optional(),
				path: z.string().min(1),
				readOnly: z.boolean().optional(),
				skipHostKeyCheck: z.boolean(),
				knownHosts: z.string().optional(),
				allowLegacySshRsa: z.boolean(),
				allowUnsafeSymlinkTargets: z.boolean(),
			})
			.strict(),
	])
	.superRefine((config, context) => {
		if (
			config.backend === "sftp" &&
			config.allowUnsafeSymlinkTargets &&
			(config.skipHostKeyCheck || !config.knownHosts?.trim())
		) {
			context.addIssue({
				code: "custom",
				message: "Unsafe symlink targets require host key verification with known hosts",
				path: ["allowUnsafeSymlinkTargets"],
			});
		}
	});

const headerNamePattern = /^[A-Za-z0-9-]+$/;
const notificationHeaderSchema = z.string().refine((header) => {
	const [key, value] = header.split(":", 2);

	return !!key && headerNamePattern.test(key.trim()) && (value?.trim().length ?? 0) > 0;
}, "Headers must use non-empty Key: Value format with valid header names");

const notificationConfigSchema = z.discriminatedUnion("type", [
	z
		.object({
			type: z.literal("email"),
			smtpHost: z.string().trim().min(1),
			smtpPort: z.number().int().min(1).max(65535),
			username: z.string().optional(),
			password: z.string().optional(),
			from: z.string().min(1),
			fromName: z.string().optional(),
			to: z.array(z.string()),
			useTLS: z.boolean(),
		})
		.strict(),
	z
		.object({
			type: z.literal("slack"),
			webhookUrl: z.string().min(1),
			username: z.string().optional(),
			iconEmoji: z.string().optional(),
		})
		.strict(),
	z
		.object({
			type: z.literal("discord"),
			webhookUrl: z.string().min(1),
			username: z.string().optional(),
			avatarUrl: z.string().optional(),
			threadId: z.string().optional(),
		})
		.strict(),
	z
		.object({
			type: z.literal("gotify"),
			serverUrl: z.string().min(1),
			token: z.string().min(1),
			path: z.string().optional(),
			priority: z.number().min(0).max(10),
		})
		.strict(),
	z
		.object({
			type: z.literal("ntfy"),
			serverUrl: z.string().optional(),
			topic: z.string().min(1),
			priority: z.enum(["max", "high", "default", "low", "min"]),
			username: z.string().optional(),
			password: z.string().optional(),
			accessToken: z.string().optional(),
		})
		.strict(),
	z
		.object({
			type: z.literal("pushover"),
			userKey: z.string().min(1),
			apiToken: z.string().min(1),
			devices: z.string().optional(),
			priority: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
		})
		.strict(),
	z
		.object({
			type: z.literal("telegram"),
			botToken: z.string().min(1),
			chatId: z.string().min(1),
			threadId: z.string().optional(),
		})
		.strict(),
	z
		.object({
			type: z.literal("generic"),
			url: z.string().min(1),
			method: z.enum(["GET", "POST"]),
			contentType: z.string().optional(),
			headers: z.array(notificationHeaderSchema).optional(),
			useJson: z.boolean().optional(),
			titleKey: z.string().optional(),
			messageKey: z.string().optional(),
		})
		.strict(),
	z
		.object({
			type: z.literal("custom"),
			shoutrrrUrl: z.string().min(1),
		})
		.strict(),
]);

const backupWebhookConfigSchema = z
	.object({
		url: z.url(),
		headers: z.array(notificationHeaderSchema).optional(),
		body: z.string().optional(),
		insecureTls: z.boolean().optional(),
	})
	.strict();

const backupWebhooksSchema = z
	.object({
		pre: backupWebhookConfigSchema.nullable(),
		post: backupWebhookConfigSchema.nullable(),
	})
	.strict();

const retentionPolicySchema = z
	.object({
		keepLast: z.number().optional(),
		keepHourly: z.number().optional(),
		keepDaily: z.number().optional(),
		keepWeekly: z.number().optional(),
		keepMonthly: z.number().optional(),
		keepYearly: z.number().optional(),
		keepWithinDuration: z.string().optional(),
	})
	.strict();

const exportedRepositorySchema = z
	.object({
		ref: transferRefSchema,
		name: z.string().min(1),
		config: repositoryConfigSchema,
		compressionMode: z.enum(["off", "auto", "max"]),
		autoCheckEnabled: z.boolean(),
	})
	.strict();

const exportedVolumeSchema = z
	.object({
		ref: transferRefSchema,
		name: z.string().min(1),
		config: volumeConfigSchema,
		autoRemount: z.boolean(),
	})
	.strict();

const exportedBackupScheduleSchema = z
	.object({
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
		compressionMode: z.enum(["off", "auto", "max"]).nullable(),
		backupWebhooks: backupWebhooksSchema.nullable(),
		maxRetries: z.number().min(0).max(32),
		retryDelay: z.number().min(60_000).max(86_400_000),
		sortOrder: z.number().int(),
	})
	.strict();

const exportedNotificationDestinationSchema = z
	.object({
		ref: transferRefSchema,
		name: z.string().min(1),
		enabled: z.boolean(),
		config: notificationConfigSchema,
	})
	.strict();

const exportedBackupScheduleMirrorSchema = z
	.object({
		scheduleRef: transferRefSchema,
		repositoryRef: transferRefSchema,
		enabled: z.boolean(),
	})
	.strict();

const exportedBackupScheduleNotificationSchema = z
	.object({
		scheduleRef: transferRefSchema,
		destinationRef: transferRefSchema,
		notifyOnStart: z.boolean(),
		notifyOnSuccess: z.boolean(),
		notifyOnWarning: z.boolean(),
		notifyOnFailure: z.boolean(),
	})
	.strict();

export const configTransferPayloadV1Schema = z
	.object({
		version: z.literal(1),
		resticPassword: z.string().min(1),
		repositories: z.array(exportedRepositorySchema),
		volumes: z.array(exportedVolumeSchema),
		backupSchedules: z.array(exportedBackupScheduleSchema),
		notificationDestinations: z.array(exportedNotificationDestinationSchema),
		backupScheduleMirrors: z.array(exportedBackupScheduleMirrorSchema),
		backupScheduleNotifications: z.array(exportedBackupScheduleNotificationSchema),
	})
	.strict();

export type ConfigTransferPayloadV1 = z.infer<typeof configTransferPayloadV1Schema>;
