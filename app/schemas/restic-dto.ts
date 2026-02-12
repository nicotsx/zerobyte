import { type } from "arktype";

export const resticSummaryBaseSchema = type({
	files_new: "number",
	files_changed: "number",
	files_unmodified: "number",
	dirs_new: "number",
	dirs_changed: "number",
	dirs_unmodified: "number",
	data_blobs: "number",
	tree_blobs: "number",
	data_added: "number",
	data_added_packed: "number?",
	total_files_processed: "number",
	total_bytes_processed: "number",
});

export const resticSnapshotSummarySchema = resticSummaryBaseSchema.and(
	type({
		backup_start: "string",
		backup_end: "string",
	}),
);

export const resticBackupRunSummarySchema = resticSummaryBaseSchema.and(
	type({
		total_duration: "number",
		snapshot_id: "string",
	}),
);

export const resticBackupOutputSchema = resticBackupRunSummarySchema.and(
	type({
		message_type: "'summary'",
	}),
);

export const resticBackupProgressMetricsSchema = type({
	seconds_elapsed: "number",
	percent_done: "number",
	total_files: "number",
	files_done: "number",
	total_bytes: "number",
	bytes_done: "number",
	current_files: "string[]",
});

export const resticBackupProgressSchema = resticBackupProgressMetricsSchema.and(
	type({
		message_type: "'status'",
	}),
);

export const resticRestoreOutputSchema = type({
	message_type: "'summary'",
	total_files: "number?",
	files_restored: "number",
	files_skipped: "number",
	total_bytes: "number?",
	bytes_restored: "number?",
	bytes_skipped: "number",
});

export type ResticSnapshotSummaryDto = typeof resticSnapshotSummarySchema.infer;
export type ResticBackupRunSummaryDto = typeof resticBackupRunSummarySchema.infer;
export type ResticBackupOutputDto = typeof resticBackupOutputSchema.infer;
export type ResticBackupProgressMetricsDto = typeof resticBackupProgressMetricsSchema.infer;
export type ResticBackupProgressDto = typeof resticBackupProgressSchema.infer;

export type ResticRestoreOutputDto = typeof resticRestoreOutputSchema.infer;
