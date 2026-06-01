import path from "node:path";

export const RUSTFS_ENDPOINT = "http://rustfs:9000";
export const RUSTFS_ACCESS_KEY_ID = "rustfsadmin";
export const RUSTFS_SECRET_ACCESS_KEY = "rustfsadmin";
export const RUSTFS_BUCKET = "zerobyte-integration";

export const RCLONE_REMOTE = "e2e-rustfs";
export const RCLONE_CONFIG_DIR = "/root/.config/rclone";
export const RCLONE_CONFIG_FILE = path.join(RCLONE_CONFIG_DIR, "rclone.conf");

export const INTEGRATION_ORGANIZATION_ID = "integration-suite";
export const INTEGRATION_ARTIFACTS_DIR = path.resolve(import.meta.dirname, "../artifacts");
export const INTEGRATION_RUNS_DIR = path.join(INTEGRATION_ARTIFACTS_DIR, "runs");
