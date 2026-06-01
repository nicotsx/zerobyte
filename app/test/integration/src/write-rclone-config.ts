import fs from "node:fs/promises";
import {
	RCLONE_CONFIG_DIR,
	RCLONE_CONFIG_FILE,
	RCLONE_REMOTE,
	RUSTFS_ACCESS_KEY_ID,
	RUSTFS_ENDPOINT,
	RUSTFS_SECRET_ACCESS_KEY,
} from "./constants";

const rcloneConfig = `[${RCLONE_REMOTE}]
type = s3
provider = Minio
env_auth = false
access_key_id = ${RUSTFS_ACCESS_KEY_ID}
secret_access_key = ${RUSTFS_SECRET_ACCESS_KEY}
endpoint = ${RUSTFS_ENDPOINT}
force_path_style = true
acl = private
`;

await fs.mkdir(RCLONE_CONFIG_DIR, { recursive: true });
await fs.writeFile(RCLONE_CONFIG_FILE, rcloneConfig, { mode: 0o600 });
await fs.chmod(RCLONE_CONFIG_FILE, 0o600);
