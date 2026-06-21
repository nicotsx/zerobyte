import { backupWebhooksSchema } from "@zerobyte/core/backup-hooks";
import { BANDWIDTH_UNITS, COMPRESSION_MODES, repositoryConfigSchema } from "@zerobyte/core/restic";
import { z } from "zod";
import { volumeConfigSchema } from "@zerobyte/contracts/volumes";
import { notificationConfigSchema } from "~/schemas/notifications";

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
	backupWebhooks: backupWebhooksSchema.nullable().default(null),
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

export const configTransferPayloadV1Schema = z.object({
	version: z.literal(1),
	resticPassword: z.string().min(1),
	repositories: z.array(exportedRepositorySchema),
	volumes: z.array(exportedVolumeSchema),
	backupSchedules: z.array(exportedBackupScheduleSchema),
	notificationDestinations: z.array(exportedNotificationDestinationSchema),
	backupScheduleMirrors: z.array(exportedBackupScheduleMirrorSchema),
	backupScheduleNotifications: z.array(exportedBackupScheduleNotificationSchema),
});

export type ConfigTransferPayloadV1 = z.infer<typeof configTransferPayloadV1Schema>;
