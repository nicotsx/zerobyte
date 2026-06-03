import type { BackendConfig } from "@zerobyte/contracts/volumes";

export const WEBDAV_HOST = "webdav";
export const WEBDAV_PORT = 80;
export const WEBDAV_USERNAME = "zerobyte-webdav";
export const WEBDAV_PASSWORD = "zerobyte-webdav-password";
export const WEBDAV_FIXTURE_ROOT = "/zerobyte-integration";

export const buildWebdavVolumeConfig = (): BackendConfig => ({
	backend: "webdav",
	server: WEBDAV_HOST,
	path: WEBDAV_FIXTURE_ROOT,
	username: WEBDAV_USERNAME,
	password: WEBDAV_PASSWORD,
	port: WEBDAV_PORT,
	readOnly: true,
	ssl: false,
});
