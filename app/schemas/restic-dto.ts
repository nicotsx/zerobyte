import { z } from "zod";

export const resticSummaryBaseSchema = z.object({
	files_new: z.number(),
	files_changed: z.number(),
	files_unmodified: z.number(),
	dirs_new: z.number(),
	dirs_changed: z.number(),
	dirs_unmodified: z.number(),
	data_blobs: z.number(),
	tree_blobs: z.number(),
	data_added: z.number(),
	data_added_packed: z.number().optional(),
	total_files_processed: z.number(),
	total_bytes_processed: z.number(),
});

export const resticSnapshotSummarySchema = resticSummaryBaseSchema.extend({
	backup_start: z.string(),
	backup_end: z.string(),
});

export const resticBackupRunSummarySchema = resticSummaryBaseSchema.extend({
	total_duration: z.number(),
	snapshot_id: z.string(),
});

export const resticBackupOutputSchema = resticBackupRunSummarySchema.extend({
	message_type: z.literal("summary"),
});

export const resticBackupProgressMetricsSchema = z.object({
	seconds_elapsed: z.number(),
	percent_done: z.number(),
	total_files: z.number(),
	files_done: z.number(),
	total_bytes: z.number(),
	bytes_done: z.number(),
	current_files: z.array(z.string()).default([]),
});

export const resticBackupProgressSchema = resticBackupProgressMetricsSchema.extend({
	message_type: z.literal("status"),
});

export const resticRestoreOutputSchema = z.object({
	message_type: z.literal("summary"),
	total_files: z.number().optional(),
	files_restored: z.number(),
	files_skipped: z.number(),
	total_bytes: z.number().optional(),
	bytes_restored: z.number().optional(),
	bytes_skipped: z.number(),
});

export const resticStatsSchema = z.object({
	total_size: z.number().default(0),
	total_uncompressed_size: z.number().default(0),
	compression_ratio: z.number().default(0),
	compression_progress: z.number().default(0),
	compression_space_saving: z.number().default(0),
	snapshots_count: z.number().default(0),
});

export type ResticSnapshotSummaryDto = z.infer<typeof resticSnapshotSummarySchema>;
export type ResticBackupRunSummaryDto = z.infer<typeof resticBackupRunSummarySchema>;
export type ResticBackupOutputDto = z.infer<typeof resticBackupOutputSchema>;
export type ResticBackupProgressMetricsDto = z.infer<typeof resticBackupProgressMetricsSchema>;
export type ResticBackupProgressDto = z.infer<typeof resticBackupProgressSchema>;

export type ResticRestoreOutputDto = z.infer<typeof resticRestoreOutputSchema>;
export type ResticStatsDto = z.infer<typeof resticStatsSchema>;
