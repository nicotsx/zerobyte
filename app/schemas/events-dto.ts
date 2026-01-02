import { type } from "arktype";
import { resticBackupProgressMetricsSchema, resticBackupRunSummarySchema } from "~/schemas/restic-dto";

export const backupEventStatusSchema = type("'success' | 'error' | 'stopped' | 'warning'");
export const restoreEventStatusSchema = type("'success' | 'error'");

const backupEventBaseSchema = type({
	scheduleId: "number",
	volumeName: "string",
	repositoryName: "string",
});

const organizationScopedSchema = type({
	organizationId: "string",
});

const restoreEventBaseSchema = type({
	repositoryId: "string",
	snapshotId: "string",
});

const restoreProgressMetricsSchema = type({
	seconds_elapsed: "number",
	percent_done: "number",
	total_files: "number",
	files_done: "number",
	total_bytes: "number",
	bytes_done: "number",
});

export const backupStartedEventSchema = backupEventBaseSchema;

export const backupProgressEventSchema = backupEventBaseSchema.and(resticBackupProgressMetricsSchema);

export const backupCompletedEventSchema = backupEventBaseSchema.and(
	type({
		status: backupEventStatusSchema,
		summary: resticBackupRunSummarySchema.optional(),
	}),
);

export const restoreStartedEventSchema = restoreEventBaseSchema;

export const restoreProgressEventSchema = restoreEventBaseSchema.and(restoreProgressMetricsSchema);

export const restoreCompletedEventSchema = restoreEventBaseSchema.and(
	type({
		status: restoreEventStatusSchema,
		error: "string?",
	}),
);

export const serverBackupStartedEventSchema = organizationScopedSchema.and(backupStartedEventSchema);

export const serverBackupProgressEventSchema = organizationScopedSchema.and(backupProgressEventSchema);

export const serverBackupCompletedEventSchema = organizationScopedSchema.and(backupCompletedEventSchema);

export const serverRestoreStartedEventSchema = organizationScopedSchema.and(restoreStartedEventSchema);

export const serverRestoreProgressEventSchema = organizationScopedSchema.and(restoreProgressEventSchema);

export const serverRestoreCompletedEventSchema = organizationScopedSchema.and(restoreCompletedEventSchema);

export type BackupEventStatusDto = typeof backupEventStatusSchema.infer;
export type BackupStartedEventDto = typeof backupStartedEventSchema.infer;
export type BackupProgressEventDto = typeof backupProgressEventSchema.infer;
export type BackupCompletedEventDto = typeof backupCompletedEventSchema.infer;
export type RestoreStartedEventDto = typeof restoreStartedEventSchema.infer;
export type RestoreProgressEventDto = typeof restoreProgressEventSchema.infer;
export type RestoreCompletedEventDto = typeof restoreCompletedEventSchema.infer;
export type ServerBackupStartedEventDto = typeof serverBackupStartedEventSchema.infer;
export type ServerBackupProgressEventDto = typeof serverBackupProgressEventSchema.infer;
export type ServerBackupCompletedEventDto = typeof serverBackupCompletedEventSchema.infer;
export type ServerRestoreStartedEventDto = typeof serverRestoreStartedEventSchema.infer;
export type ServerRestoreProgressEventDto = typeof serverRestoreProgressEventSchema.infer;
export type ServerRestoreCompletedEventDto = typeof serverRestoreCompletedEventSchema.infer;
