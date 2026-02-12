import { type } from "arktype";
import { resticBackupProgressMetricsSchema, resticBackupRunSummarySchema } from "~/schemas/restic-dto";

export const backupEventStatusSchema = type("'success' | 'error' | 'stopped' | 'warning'");

const backupEventBaseSchema = type({
	scheduleId: "number",
	volumeName: "string",
	repositoryName: "string",
});

const organizationScopedSchema = type({
	organizationId: "string",
});

export const backupStartedEventSchema = backupEventBaseSchema;

export const backupProgressEventSchema = backupEventBaseSchema.and(resticBackupProgressMetricsSchema);

export const backupCompletedEventSchema = backupEventBaseSchema.and(
	type({
		status: backupEventStatusSchema,
		summary: resticBackupRunSummarySchema.optional(),
	}),
);

export const serverBackupStartedEventSchema = organizationScopedSchema.and(backupStartedEventSchema);

export const serverBackupProgressEventSchema = organizationScopedSchema.and(backupProgressEventSchema);

export const serverBackupCompletedEventSchema = organizationScopedSchema.and(backupCompletedEventSchema);

export type BackupEventStatusDto = typeof backupEventStatusSchema.infer;
export type BackupStartedEventDto = typeof backupStartedEventSchema.infer;
export type BackupProgressEventDto = typeof backupProgressEventSchema.infer;
export type BackupCompletedEventDto = typeof backupCompletedEventSchema.infer;
export type ServerBackupStartedEventDto = typeof serverBackupStartedEventSchema.infer;
export type ServerBackupProgressEventDto = typeof serverBackupProgressEventSchema.infer;
export type ServerBackupCompletedEventDto = typeof serverBackupCompletedEventSchema.infer;
