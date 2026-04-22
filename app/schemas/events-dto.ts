import { z } from "zod";
import { resticBackupProgressMetricsSchema, resticBackupRunSummarySchema } from "@zerobyte/core/restic";

const backupEventStatusSchema = z.enum(["success", "error", "stopped", "warning"]);
const restoreEventStatusSchema = z.enum(["success", "error"]);

const backupEventBaseSchema = z.object({
	scheduleId: z.string(),
	volumeName: z.string(),
	repositoryName: z.string(),
});

const organizationScopedSchema = z.object({
	organizationId: z.string(),
});

const restoreEventBaseSchema = z.object({
	repositoryId: z.string(),
	snapshotId: z.string(),
});

const dumpStartedEventSchema = z.object({
	repositoryId: z.string(),
	snapshotId: z.string(),
	path: z.string(),
	filename: z.string(),
});

const restoreProgressMetricsSchema = z.object({
	seconds_elapsed: z.number().default(0),
	percent_done: z.number().default(0),
	total_files: z.number().default(0),
	files_restored: z.number().default(0),
	total_bytes: z.number().default(0),
	bytes_restored: z.number().default(0),
});

const backupStartedEventSchema = backupEventBaseSchema;

export const backupProgressEventSchema = backupEventBaseSchema.extend(resticBackupProgressMetricsSchema.shape);

const backupCompletedEventSchema = backupEventBaseSchema.extend({
	status: backupEventStatusSchema,
	summary: resticBackupRunSummarySchema.optional(),
});

const restoreStartedEventSchema = restoreEventBaseSchema;

const restoreProgressEventSchema = restoreEventBaseSchema.extend(restoreProgressMetricsSchema.shape);

const restoreCompletedEventSchema = restoreEventBaseSchema.extend({
	status: restoreEventStatusSchema,
	error: z.string().optional(),
});

const serverBackupStartedEventSchema = organizationScopedSchema.extend(backupStartedEventSchema.shape);

const serverBackupProgressEventSchema = organizationScopedSchema.extend(backupProgressEventSchema.shape);

const serverBackupCompletedEventSchema = organizationScopedSchema.extend(backupCompletedEventSchema.shape);

const serverRestoreStartedEventSchema = organizationScopedSchema.extend(restoreStartedEventSchema.shape);

const serverRestoreProgressEventSchema = organizationScopedSchema.extend(restoreProgressEventSchema.shape);

const serverRestoreCompletedEventSchema = organizationScopedSchema.extend(restoreCompletedEventSchema.shape);

const serverDumpStartedEventSchema = organizationScopedSchema.extend(dumpStartedEventSchema.shape);

export type BackupProgressEventDto = z.infer<typeof backupProgressEventSchema>;
export type ServerBackupStartedEventDto = z.infer<typeof serverBackupStartedEventSchema>;
export type ServerBackupProgressEventDto = z.infer<typeof serverBackupProgressEventSchema>;
export type ServerBackupCompletedEventDto = z.infer<typeof serverBackupCompletedEventSchema>;
export type ServerRestoreStartedEventDto = z.infer<typeof serverRestoreStartedEventSchema>;
export type ServerRestoreProgressEventDto = z.infer<typeof serverRestoreProgressEventSchema>;
export type ServerRestoreCompletedEventDto = z.infer<typeof serverRestoreCompletedEventSchema>;
export type ServerDumpStartedEventDto = z.infer<typeof serverDumpStartedEventSchema>;
