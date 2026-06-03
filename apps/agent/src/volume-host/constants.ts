import * as path from "node:path";
import * as os from "node:os";

export const OPERATION_TIMEOUT = 5000;
export const VOLUME_MOUNT_BASE = process.env.ZEROBYTE_VOLUMES_DIR || "/var/lib/zerobyte/volumes";
export const SSH_KEYS_DIR = path.join(os.tmpdir(), "zerobyte-ssh");
export const RCLONE_CONFIG_DIR = process.env.RCLONE_CONFIG_DIR || "/root/.config/rclone";
export const RCLONE_CONFIG_FILE = path.join(RCLONE_CONFIG_DIR, "rclone.conf");
const serverIdleTimeout = Number(process.env.SERVER_IDLE_TIMEOUT ?? 60);
export const RCLONE_TIMEOUT = (Number.isFinite(serverIdleTimeout) ? serverIdleTimeout : 60) * 1000;
