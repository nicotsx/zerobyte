import { z } from "zod";
import { resticBackupProgressMetricsSchema, resticBackupRunSummarySchema } from "@zerobyte/core/restic";

export const backupEventStatusSchema = z.enum(["success", "error", "stopped", "warning"]);
export const restoreEventStatusSchema = z.enum(["success", "error"]);

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

export const backupStartedEventSchema = backupEventBaseSchema;

export const backupProgressEventSchema = backupEventBaseSchema.extend(resticBackupProgressMetricsSchema.shape);

export const backupCompletedEventSchema = backupEventBaseSchema.extend({
	status: backupEventStatusSchema,
	summary: resticBackupRunSummarySchema.optional(),
});

export const restoreStartedEventSchema = restoreEventBaseSchema;

export const restoreProgressEventSchema = restoreEventBaseSchema.extend(restoreProgressMetricsSchema.shape);

export const restoreCompletedEventSchema = restoreEventBaseSchema.extend({
	status: restoreEventStatusSchema,
	error: z.string().optional(),
});

export const serverBackupStartedEventSchema = organizationScopedSchema.extend(backupStartedEventSchema.shape);

export const serverBackupProgressEventSchema = organizationScopedSchema.extend(backupProgressEventSchema.shape);

export const serverBackupCompletedEventSchema = organizationScopedSchema.extend(backupCompletedEventSchema.shape);

export const serverRestoreStartedEventSchema = organizationScopedSchema.extend(restoreStartedEventSchema.shape);

export const serverRestoreProgressEventSchema = organizationScopedSchema.extend(restoreProgressEventSchema.shape);

export const serverRestoreCompletedEventSchema = organizationScopedSchema.extend(restoreCompletedEventSchema.shape);

export const serverDumpStartedEventSchema = organizationScopedSchema.extend(dumpStartedEventSchema.shape);

export type BackupEventStatusDto = z.infer<typeof backupEventStatusSchema>;
export type BackupStartedEventDto = z.infer<typeof backupStartedEventSchema>;
export type BackupProgressEventDto = z.infer<typeof backupProgressEventSchema>;
export type BackupCompletedEventDto = z.infer<typeof backupCompletedEventSchema>;
export type RestoreStartedEventDto = z.infer<typeof restoreStartedEventSchema>;
export type RestoreProgressEventDto = z.infer<typeof restoreProgressEventSchema>;
export type RestoreCompletedEventDto = z.infer<typeof restoreCompletedEventSchema>;
export type DumpStartedEventDto = z.infer<typeof dumpStartedEventSchema>;
export type ServerBackupStartedEventDto = z.infer<typeof serverBackupStartedEventSchema>;
export type ServerBackupProgressEventDto = z.infer<typeof serverBackupProgressEventSchema>;
export type ServerBackupCompletedEventDto = z.infer<typeof serverBackupCompletedEventSchema>;
export type ServerRestoreStartedEventDto = z.infer<typeof serverRestoreStartedEventSchema>;
export type ServerRestoreProgressEventDto = z.infer<typeof serverRestoreProgressEventSchema>;
export type ServerRestoreCompletedEventDto = z.infer<typeof serverRestoreCompletedEventSchema>;
export type ServerDumpStartedEventDto = z.infer<typeof serverDumpStartedEventSchema>;
