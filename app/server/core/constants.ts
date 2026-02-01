export const OPERATION_TIMEOUT = 5000;

export const VOLUME_MOUNT_BASE = process.env.ZEROBYTE_VOLUMES_DIR || "/var/lib/zerobyte/volumes";
export const REPOSITORY_BASE = process.env.ZEROBYTE_REPOSITORIES_DIR || "/var/lib/zerobyte/repositories";

export const RESTIC_CACHE_DIR = process.env.RESTIC_CACHE_DIR || "/var/lib/zerobyte/restic/cache";

export const DATABASE_URL = process.env.DATABASE_URL || "/var/lib/zerobyte/data/zerobyte.db";
export const RESTIC_PASS_FILE = process.env.RESTIC_PASS_FILE || "/var/lib/zerobyte/data/restic.pass";

export const RCLONE_CONFIG_DIR = process.env.RCLONE_CONFIG_DIR || "/root/.config/rclone";

export const DEFAULT_EXCLUDES = [DATABASE_URL, RESTIC_PASS_FILE, REPOSITORY_BASE];
