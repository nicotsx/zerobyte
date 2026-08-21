const ACTIVE_BACKUP_PROGRESS_MAX = 99;

type BackupEtaMetrics = {
	bytesDone: number;
	totalBytes: number;
	secondsElapsed: number;
	secondsRemaining: number;
};

export const getActiveBackupPercent = (reportedPercent: number) => {
	if (!Number.isFinite(reportedPercent)) return 0;

	const roundedPercent = Math.round(reportedPercent * 100);
	const nonNegativePercent = Math.max(0, roundedPercent);

	return Math.min(nonNegativePercent, ACTIVE_BACKUP_PROGRESS_MAX);
};

export const hasCoherentBackupEta = ({ bytesDone, totalBytes, secondsElapsed, secondsRemaining }: BackupEtaMetrics) => {
	const values = [bytesDone, totalBytes, secondsElapsed, secondsRemaining];
	const hasFiniteValues = values.every(Number.isFinite);
	const remainingBytes = totalBytes - bytesDone;

	return (
		hasFiniteValues &&
		bytesDone >= 0 &&
		totalBytes > 0 &&
		secondsElapsed > 0 &&
		secondsRemaining > 0 &&
		remainingBytes > 0
	);
};
