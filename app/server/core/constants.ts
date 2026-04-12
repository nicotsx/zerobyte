import path from "node:path";

export const OPERATION_TIMEOUT = 5000;

export const VOLUME_MOUNT_BASE = process.env.ZEROBYTE_VOLUMES_DIR || "/var/lib/zerobyte/volumes";
export const REPOSITORY_BASE = process.env.ZEROBYTE_REPOSITORIES_DIR || "/var/lib/zerobyte/repositories";

export const RESTIC_CACHE_DIR = process.env.RESTIC_CACHE_DIR || "/var/lib/zerobyte/restic/cache";

export const DATABASE_URL = process.env.ZEROBYTE_DATABASE_URL || "/var/lib/zerobyte/data/zerobyte.db";
export const RESTIC_PASS_FILE = process.env.RESTIC_PASS_FILE || "/var/lib/zerobyte/data/restic.pass";
export const SSH_KEYS_DIR = "/var/lib/zerobyte/ssh";

export const RCLONE_CONFIG_DIR = process.env.RCLONE_CONFIG_DIR || "/root/.config/rclone";
export const RCLONE_CONFIG_FILE = path.join(RCLONE_CONFIG_DIR, "rclone.conf");
export const RESTORE_BLOCKED_ROOTS = [REPOSITORY_BASE, RESTIC_CACHE_DIR, SSH_KEYS_DIR, RCLONE_CONFIG_DIR, "/app"];

export const DEFAULT_EXCLUDES = [RESTIC_PASS_FILE, REPOSITORY_BASE];

export const REGISTRATION_ENABLED_KEY = "registrations_enabled";
