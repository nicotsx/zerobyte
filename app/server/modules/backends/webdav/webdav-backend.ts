import { execFile as execFileCb } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { promisify } from "node:util";
import { OPERATION_TIMEOUT } from "../../../core/constants";
import { cryptoUtils } from "../../../utils/crypto";
import { toMessage } from "../../../utils/errors";
import { logger } from "../../../utils/logger";
import { getMountForPath } from "../../../utils/mountinfo";
import { withTimeout } from "../../../utils/timeout";
import type { VolumeBackend } from "../backend";
import { executeMount, executeUnmount } from "../utils/backend-utils";
import { BACKEND_STATUS, type BackendConfig } from "~/schemas/volumes";

const execFile = promisify(execFileCb);

const mount = async (config: BackendConfig, path: string) => {
	logger.debug(`Mounting WebDAV volume ${path}...`);

	if (config.backend !== "webdav") {
		logger.error("Provided config is not for WebDAV backend");
		return { status: BACKEND_STATUS.error, error: "Provided config is not for WebDAV backend" };
	}

	if (os.platform() !== "linux") {
		logger.error("WebDAV mounting is only supported on Linux hosts.");
		return { status: BACKEND_STATUS.error, error: "WebDAV mounting is only supported on Linux hosts." };
	}

	const { status } = await checkHealth(path);
	if (status === "mounted") {
		return { status: BACKEND_STATUS.mounted };
	}

	logger.debug(`Trying to unmount any existing mounts at ${path} before mounting...`);
	await unmount(path);

	const run = async () => {
		await fs.mkdir(path, { recursive: true }).catch((err) => {
			logger.warn(`Failed to create directory ${path}: ${err.message}`);
		});

		const protocol = config.ssl ? "https" : "http";
		const defaultPort = config.ssl ? 443 : 80;
		const port = config.port !== defaultPort ? `:${config.port}` : "";
		const source = `${protocol}://${config.server}${port}${config.path}`;

		const options = config.readOnly
			? ["uid=1000", "gid=1000", "file_mode=0444", "dir_mode=0555", "ro"]
			: ["uid=1000", "gid=1000", "file_mode=0664", "dir_mode=0775"];

		if (config.username && config.password) {
			const password = await cryptoUtils.resolveSecret(config.password);
			const secretsFile = "/etc/davfs2/secrets";
			const secretsContent = `${source} ${config.username} ${password}\n`;
			await fs.appendFile(secretsFile, secretsContent, { mode: 0o600 });
		}

		logger.debug(`Mounting WebDAV volume ${path}...`);

		const args = ["-t", "davfs", source, path];
		await executeMount(args);

		const { stderr } = await execFile("mount", ["-t", "davfs", "-o", options.join(","), source, path], {
			timeout: OPERATION_TIMEOUT,
			maxBuffer: 1024 * 1024,
		});

		if (stderr?.trim()) {
			logger.warn(stderr.trim());
		}

		logger.info(`WebDAV volume at ${path} mounted successfully.`);
		return { status: BACKEND_STATUS.mounted };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT, "WebDAV mount");
	} catch (error) {
		const errorMsg = toMessage(error);

		if (errorMsg.includes("already mounted")) {
			return { status: BACKEND_STATUS.mounted };
		}

		logger.error("Error mounting WebDAV volume", { error: errorMsg });

		if (errorMsg.includes("option") && errorMsg.includes("requires argument")) {
			return {
				status: BACKEND_STATUS.error,
				error: "Invalid mount options. Please check your WebDAV server configuration.",
			};
		} else if (errorMsg.includes("connection refused") || errorMsg.includes("Connection refused")) {
			return {
				status: BACKEND_STATUS.error,
				error: "Cannot connect to WebDAV server. Please check the server address and port.",
			};
		} else if (errorMsg.includes("unauthorized") || errorMsg.includes("Unauthorized")) {
			return {
				status: BACKEND_STATUS.error,
				error: "Authentication failed. Please check your username and password.",
			};
		}

		return { status: BACKEND_STATUS.error, error: errorMsg };
	}
};

const unmount = async (path: string) => {
	if (os.platform() !== "linux") {
		logger.error("WebDAV unmounting is only supported on Linux hosts.");
		return { status: BACKEND_STATUS.error, error: "WebDAV unmounting is only supported on Linux hosts." };
	}

	const run = async () => {
		try {
			await fs.access(path);
		} catch (e) {
			logger.warn(`Path ${path} does not exist. Skipping unmount.`, e);
			return { status: BACKEND_STATUS.unmounted };
		}

		await executeUnmount(path);

		await fs.rmdir(path);

		logger.info(`WebDAV volume at ${path} unmounted successfully.`);
		return { status: BACKEND_STATUS.unmounted };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT, "WebDAV unmount");
	} catch (error) {
		logger.error("Error unmounting WebDAV volume", { path, error: toMessage(error) });
		return { status: BACKEND_STATUS.error, error: toMessage(error) };
	}
};

const checkHealth = async (path: string) => {
	const run = async () => {
		logger.debug(`Checking health of WebDAV volume at ${path}...`);
		await fs.access(path);

		const mount = await getMountForPath(path);

		if (!mount || mount.fstype !== "fuse") {
			throw new Error(`Path ${path} is not mounted as WebDAV.`);
		}

		logger.debug(`WebDAV volume at ${path} is healthy and mounted.`);
		return { status: BACKEND_STATUS.mounted };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT, "WebDAV health check");
	} catch (error) {
		logger.error("WebDAV volume health check failed:", toMessage(error));
		return { status: BACKEND_STATUS.error, error: toMessage(error) };
	}
};

export const makeWebdavBackend = (config: BackendConfig, path: string): VolumeBackend => ({
	mount: () => mount(config, path),
	unmount: () => unmount(path),
	checkHealth: () => checkHealth(path),
});
