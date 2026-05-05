import * as path from "node:path";

export const OPERATION_TIMEOUT = 5000;
export const VOLUME_MOUNT_BASE = process.env.ZEROBYTE_VOLUMES_DIR || "/var/lib/zerobyte/volumes";
export const SSH_KEYS_DIR = "/var/lib/zerobyte/ssh";
export const RCLONE_CONFIG_DIR = process.env.RCLONE_CONFIG_DIR || "/root/.config/rclone";
export const RCLONE_CONFIG_FILE = path.join(RCLONE_CONFIG_DIR, "rclone.conf");
const serverIdleTimeout = Number(process.env.SERVER_IDLE_TIMEOUT ?? 60);
export const RCLONE_TIMEOUT = (Number.isFinite(serverIdleTimeout) ? serverIdleTimeout : 60) * 1000;
