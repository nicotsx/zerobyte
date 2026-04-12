import * as fs from "node:fs/promises";
import * as os from "node:os";
import { OPERATION_TIMEOUT, RCLONE_CONFIG_FILE } from "../../../core/constants";
import { toMessage } from "../../../utils/errors";
import { logger } from "@zerobyte/core/node";
import { getMountForPath } from "../../../utils/mountinfo";
import { withTimeout } from "../../../utils/timeout";
import type { VolumeBackend } from "../backend";
import { assertMounted, executeUnmount } from "../utils/backend-utils";
import { BACKEND_STATUS, type BackendConfig } from "~/schemas/volumes";
import { safeExec } from "@zerobyte/core/node";
import { config as zbConfig } from "~/server/core/config";

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

	if (status === "error") {
		logger.debug(`Trying to unmount any existing mounts at ${path} before mounting...`);
		await unmount(path);
	}

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

		const result = await safeExec({
			command: "rclone",
			args,
			env: { RCLONE_CONFIG: RCLONE_CONFIG_FILE },
			timeout: zbConfig.serverIdleTimeout * 1000,
		});

		if (result.exitCode !== 0) {
			const errorMsg = result.stderr.toString() || result.stdout.toString() || "Unknown error";
			throw new Error(`Failed to mount rclone volume: ${errorMsg}`);
		}

		logger.info(`Rclone volume at ${path} mounted successfully.`);
		return { status: BACKEND_STATUS.mounted };
	};

	try {
		return await withTimeout(run(), zbConfig.serverIdleTimeout * 1000, "Rclone mount");
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
		const mount = await getMountForPath(path);
		if (!mount || mount.mountPoint !== path) {
			logger.debug(`Path ${path} is not a mount point. Skipping unmount.`);
			return { status: BACKEND_STATUS.unmounted };
		}

		await executeUnmount(path);
		await fs.rmdir(path).catch(() => {});

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
		await assertMounted(path, (fstype) => fstype.includes("rclone"));

		logger.debug(`Rclone volume at ${path} is healthy and mounted.`);
		return { status: BACKEND_STATUS.mounted };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT, "Rclone health check");
	} catch (error) {
		const message = toMessage(error);
		if (message !== "Volume is not mounted") {
			logger.error("Rclone volume health check failed:", message);
		}
		return { status: BACKEND_STATUS.error, error: message };
	}
};

export const makeRcloneBackend = (config: BackendConfig, path: string): VolumeBackend => ({
	mount: () => mount(config, path),
	unmount: () => unmount(path),
	checkHealth: () => checkHealth(path),
});
