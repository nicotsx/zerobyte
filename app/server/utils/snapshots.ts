export function getSnapshotDuration(summary?: { backup_start: string; backup_end: string }): number {
	if (!summary) return 0;
	return new Date(summary.backup_end).getTime() - new Date(summary.backup_start).getTime();
}
