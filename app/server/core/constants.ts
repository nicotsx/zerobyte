export const OPERATION_TIMEOUT = 5000;
export const VOLUME_MOUNT_BASE = "/var/lib/zerobyte/volumes";
export const REPOSITORY_BASE = "/var/lib/zerobyte/repositories";
export const DATABASE_URL = "/var/lib/zerobyte/data/ironmount.db";
export const RESTIC_PASS_FILE = "/var/lib/zerobyte/data/restic.pass";

export const DEFAULT_EXCLUDES = [
	DATABASE_URL,
	RESTIC_PASS_FILE,
	"/var/lib/zerobyte/repositories/**", // To avoid circular backups
];

export const REQUIRED_MIGRATIONS = ["v0.14.0"];
