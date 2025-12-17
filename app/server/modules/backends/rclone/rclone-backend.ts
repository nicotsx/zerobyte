import * as fs from "node:fs/promises";
import * as os from "node:os";
import { $ } from "bun";
import { OPERATION_TIMEOUT } from "../../../core/constants";
import { toMessage } from "../../../utils/errors";
import { logger } from "../../../utils/logger";
import { getMountForPath } from "../../../utils/mountinfo";
import { withTimeout } from "../../../utils/timeout";
import type { VolumeBackend } from "../backend";
import { executeUnmount } from "../utils/backend-utils";
import { BACKEND_STATUS, type BackendConfig } from "~/schemas/volumes";

const mount = async (config: BackendConfig, path: string) => {
	logger.debug(`Mounting rclone volume ${path}...`);

	if (config.backend !== "rclone") {
		logger.error("Provided config is not for rclone backend");
		return { status: BACKEND_STATUS.error, error: "Provided config is not for rclone backend" };
	}

	if (os.platform() !== "linux") {
		logger.error("Rclone mounting is only supported on Linux hosts.");
		return { status: BACKEND_STATUS.error, error: "Rclone mounting is only supported on Linux hosts." };
	}

	const { status } = await checkHealth(path);
	if (status === "mounted") {
		return { status: BACKEND_STATUS.mounted };
	}

	logger.debug(`Trying to unmount any existing mounts at ${path} before mounting...`);
	await unmount(path);

	const run = async () => {
		await fs.mkdir(path, { recursive: true });

		const remotePath = `${config.remote}:${config.path}`;
		const args = ["mount", remotePath, path, "--daemon"];

		if (config.readOnly) {
			args.push("--read-only");
		}

		args.push("--vfs-cache-mode", "writes");
		args.push("--allow-non-empty");
		args.push("--allow-other");

		logger.debug(`Mounting rclone volume ${path}...`);
		logger.info(`Executing rclone: rclone ${args.join(" ")}`);

		const result = await $`rclone ${args}`.nothrow();

		if (result.exitCode !== 0) {
			const errorMsg = result.stderr.toString() || result.stdout.toString() || "Unknown error";
			throw new Error(`Failed to mount rclone volume: ${errorMsg}`);
		}

		logger.info(`Rclone volume at ${path} mounted successfully.`);
		return { status: BACKEND_STATUS.mounted };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT, "Rclone mount");
	} catch (error) {
		const errorMsg = toMessage(error);

		logger.error("Error mounting rclone volume", { error: errorMsg });
		return { status: BACKEND_STATUS.error, error: errorMsg };
	}
};

const unmount = async (path: string) => {
	if (os.platform() !== "linux") {
		logger.error("Rclone unmounting is only supported on Linux hosts.");
		return { status: BACKEND_STATUS.error, error: "Rclone unmounting is only supported on Linux hosts." };
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

		logger.info(`Rclone volume at ${path} unmounted successfully.`);
		return { status: BACKEND_STATUS.unmounted };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT, "Rclone unmount");
	} catch (error) {
		logger.error("Error unmounting rclone volume", { path, error: toMessage(error) });
		return { status: BACKEND_STATUS.error, error: toMessage(error) };
	}
};

const checkHealth = async (path: string) => {
	const run = async () => {
		logger.debug(`Checking health of rclone volume at ${path}...`);
		await fs.access(path);

		const mount = await getMountForPath(path);

		if (!mount || mount.fstype !== "fuse.rclone") {
			throw new Error(`Path ${path} is not mounted as rclone.`);
		}

		logger.debug(`Rclone volume at ${path} is healthy and mounted.`);
		return { status: BACKEND_STATUS.mounted };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT, "Rclone health check");
	} catch (error) {
		logger.error("Rclone volume health check failed:", toMessage(error));
		return { status: BACKEND_STATUS.error, error: toMessage(error) };
	}
};

export const makeRcloneBackend = (config: BackendConfig, path: string): VolumeBackend => ({
	mount: () => mount(config, path),
	unmount: () => unmount(path),
	checkHealth: () => checkHealth(path),
});
