const RECOVERY_KEY_DOWNLOAD_SKIPPED_KEY = "zerobyte:recovery-key-download-skipped";

export function hasSkippedRecoveryKeyDownload() {
	if (typeof window === "undefined") return false;

	return window.sessionStorage.getItem(RECOVERY_KEY_DOWNLOAD_SKIPPED_KEY) === "true";
}

export function skipRecoveryKeyDownload() {
	window.sessionStorage.setItem(RECOVERY_KEY_DOWNLOAD_SKIPPED_KEY, "true");
}
