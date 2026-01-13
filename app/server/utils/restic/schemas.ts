import { type } from "arktype";

export const backupOutputSchema = type({
	message_type: "'summary'",
	files_new: "number",
	files_changed: "number",
	files_unmodified: "number",
	dirs_new: "number",
	dirs_changed: "number",
	dirs_unmodified: "number",
	data_blobs: "number",
	tree_blobs: "number",
	data_added: "number",
	total_files_processed: "number",
	total_bytes_processed: "number",
	total_duration: "number",
	snapshot_id: "string",
});

export type BackupOutput = typeof backupOutputSchema.infer;

export const backupProgressSchema = type({
	message_type: "'status'",
	seconds_elapsed: "number",
	percent_done: "number",
	total_files: "number",
	files_done: "number",
	total_bytes: "number",
	bytes_done: "number",
	current_files: "string[]",
});

export type BackupProgress = typeof backupProgressSchema.infer;

export const restoreOutputSchema = type({
	message_type: "'summary'",
	total_files: "number?",
	files_restored: "number",
	files_skipped: "number",
	total_bytes: "number?",
	bytes_restored: "number?",
	bytes_skipped: "number",
});

export const snapshotInfoSchema = type({
	gid: "number?",
	hostname: "string",
	id: "string",
	parent: "string?",
	paths: "string[]",
	program_version: "string?",
	short_id: "string",
	time: "string",
	uid: "number?",
	username: "string?",
	tags: "string[]?",
	summary: type({
		backup_end: "string",
		backup_start: "string",
		data_added: "number",
		data_added_packed: "number",
		data_blobs: "number",
		dirs_changed: "number",
		dirs_new: "number",
		dirs_unmodified: "number",
		files_changed: "number",
		files_new: "number",
		files_unmodified: "number",
		total_bytes_processed: "number",
		total_files_processed: "number",
		tree_blobs: "number",
	}).optional(),
});

export const lsNodeSchema = type({
	name: "string",
	type: "string",
	path: "string",
	uid: "number?",
	gid: "number?",
	size: "number?",
	mode: "number?",
	mtime: "string?",
	atime: "string?",
	ctime: "string?",
	struct_type: "'node'",
});

export const lsSnapshotInfoSchema = type({
	time: "string",
	parent: "string?",
	tree: "string",
	paths: "string[]",
	hostname: "string",
	username: "string?",
	id: "string",
	short_id: "string",
	struct_type: "'snapshot'",
	message_type: "'snapshot'",
});
