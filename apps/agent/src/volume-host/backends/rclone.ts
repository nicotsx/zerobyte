import * as fs from "node:fs/promises";
import * as os from "node:os";
import { logger, safeExec } from "@zerobyte/core/node";
import { toMessage } from "@zerobyte/core/utils";
import { OPERATION_TIMEOUT, RCLONE_CONFIG_FILE, RCLONE_TIMEOUT } from "../constants";
import { withTimeout } from "../timeout";
import { getMountForPath } from "../fs";
import type { BackendConfig, VolumeBackend } from "../types";
import { assertMounted, executeUnmount } from "./utils";

const checkHealth = async (mountPath: string) => {
	const run = async () => {
		await assertMounted(mountPath, (fstype) => fstype.includes("rclone"));

		logger.debug(`Rclone volume at ${mountPath} is healthy and mounted.`);
		return { status: "mounted" as const };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT, "Rclone health check");
	} catch (error) {
		const message = toMessage(error);
		if (message !== "Volume is not mounted") {
			logger.error("Rclone volume health check failed:", message);
		}
		return { status: "error" as const, error: message };
	}
};

const unmount = async (mountPath: string) => {
	if (os.platform() !== "linux") {
		logger.error("Rclone unmounting is only supported on Linux hosts.");
		return { status: "error" as const, error: "Rclone unmounting is only supported on Linux hosts." };
	}

	const run = async () => {
		const mount = await getMountForPath(mountPath);
		if (!mount || mount.mountPoint !== mountPath) {
			logger.debug(`Path ${mountPath} is not a mount point. Skipping unmount.`);
			return { status: "unmounted" as const };
		}

		await executeUnmount(mountPath);
		await fs.rmdir(mountPath).catch(() => {});

		logger.info(`Rclone volume at ${mountPath} unmounted successfully.`);
		return { status: "unmounted" as const };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT, "Rclone unmount");
	} catch (error) {
		logger.error("Error unmounting rclone volume", { mountPath, error: toMessage(error) });
		return { status: "error" as const, error: toMessage(error) };
	}
};

const mount = async (config: BackendConfig, mountPath: string) => {
	logger.debug(`Mounting rclone volume ${mountPath}...`);

	if (config.backend !== "rclone") {
		logger.error("Provided config is not for rclone backend");
		return { status: "error" as const, error: "Provided config is not for rclone backend" };
	}

	if (os.platform() !== "linux") {
		logger.error("Rclone mounting is only supported on Linux hosts.");
		return { status: "error" as const, error: "Rclone mounting is only supported on Linux hosts." };
	}

	const { status } = await checkHealth(mountPath);
	if (status === "mounted") return { status: "mounted" as const };

	if (status === "error") {
		logger.debug(`Trying to unmount any existing mounts at ${mountPath} before mounting...`);
		await unmount(mountPath);
	}

	const run = async () => {
		await fs.mkdir(mountPath, { recursive: true });
		const args = [
			"mount",
			`${config.remote}:${config.path}`,
			mountPath,
			"--daemon",
			"--vfs-cache-mode",
			"writes",
			"--allow-non-empty",
			"--allow-other",
		];
		if (config.readOnly) args.push("--read-only");

		logger.debug(`Mounting rclone volume ${mountPath}...`);
		logger.info(`Executing rclone: rclone ${args.join(" ")}`);

		const result = await safeExec({
			command: "rclone",
			args,
			env: { RCLONE_CONFIG: RCLONE_CONFIG_FILE },
			timeout: RCLONE_TIMEOUT,
		});
		if (result.exitCode !== 0) {
			const errorMsg = result.stderr.toString() || result.stdout.toString() || "Unknown error";
			throw new Error(`Failed to mount rclone volume: ${errorMsg}`);
		}

		logger.info(`Rclone volume at ${mountPath} mounted successfully.`);
		return { status: "mounted" as const };
	};

	try {
		return await withTimeout(run(), RCLONE_TIMEOUT, "Rclone mount");
	} catch (error) {
		const errorMsg = toMessage(error);
		logger.error("Error mounting rclone volume", { error: errorMsg });
		return { status: "error" as const, error: errorMsg };
	}
};

export const makeRcloneBackend = (config: BackendConfig, mountPath: string): VolumeBackend => ({
	mount: () => mount(config, mountPath),
	unmount: () => unmount(mountPath),
	checkHealth: () => checkHealth(mountPath),
});
