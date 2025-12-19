export const generateBackupOutput = () => {
	return JSON.stringify({
		message_type: "summary",
		files_new: 10,
		files_changed: 5,
		files_unmodified: 85,
		dirs_new: 2,
		dirs_changed: 1,
		dirs_unmodified: 17,
		data_blobs: 20,
		tree_blobs: 5,
		data_added: 1048576,
		total_files_processed: 100,
		total_bytes_processed: 2097152,
		total_duration: 12.34,
		snapshot_id: "abcd1234",
	});
};
