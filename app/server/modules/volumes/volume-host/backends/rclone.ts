import * as fs from "node:fs/promises";
import * as os from "node:os";
import type { BackendConfig } from "@zerobyte/contracts/volumes";
import { logger, safeExec } from "@zerobyte/core/node";
import { buildRcloneRemotePath } from "@zerobyte/core/restic";
import { toMessage } from "@zerobyte/core/utils";
import { OPERATION_TIMEOUT, RCLONE_CONFIG_FILE, RCLONE_TIMEOUT } from "../constants";
import { TimeoutError, withTimeout } from "../timeout";
import { getMountForPath } from "../fs";
import type { VolumeBackend, VolumeBackendResult } from "../types";
import { assertMounted, executeUnmount } from "./utils";

const pendingHealthChecks = new Set<string>();

const probeMount = async (mountPath: string) => {
	await assertMounted(mountPath, (fstype) => fstype.includes("rclone"));

	const dir = await fs.opendir(mountPath);
	try {
		await dir.read();
	} finally {
		await dir.close().catch(() => {});
	}
};

const checkHealth = async (mountPath: string): Promise<VolumeBackendResult> => {
	if (pendingHealthChecks.has(mountPath)) {
		return { status: "error", error: "Rclone health check already in progress", inconclusive: true };
	}

	pendingHealthChecks.add(mountPath);
	const probe = probeMount(mountPath).finally(() => {
		pendingHealthChecks.delete(mountPath);
	});

	try {
		await withTimeout(probe, OPERATION_TIMEOUT, "Rclone health check");
		logger.debug(`Rclone volume at ${mountPath} is healthy and mounted.`);
		return { status: "mounted" };
	} catch (error) {
		const message = toMessage(error);
		if (message !== "Volume is not mounted") {
			logger.error("Rclone volume health check failed:", message);
		}
		if (error instanceof TimeoutError) return { status: "error", error: message, inconclusive: true };

		return { status: "error", error: message };
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

	const health = await checkHealth(mountPath);
	if (health.status === "mounted" || health.inconclusive) return health;

	logger.debug(`Trying to unmount any existing mounts at ${mountPath} before mounting...`);
	await unmount(mountPath);

	const run = async () => {
		await fs.mkdir(mountPath, { recursive: true });
		const args = [
			"mount",
			buildRcloneRemotePath(config.remote, config.path),
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
	};

	try {
		await withTimeout(run(), RCLONE_TIMEOUT, "Rclone mount");
	} catch (error) {
		const errorMsg = toMessage(error);
		logger.error("Error mounting rclone volume", { error: errorMsg });
		return { status: "error" as const, error: errorMsg };
	}

	const mountedHealth = await checkHealth(mountPath);
	if (mountedHealth.status === "mounted") logger.info(`Rclone volume at ${mountPath} mounted successfully.`);
	return mountedHealth;
};

export const makeRcloneBackend = (config: BackendConfig, mountPath: string): VolumeBackend => ({
	mount: () => mount(config, mountPath),
	unmount: () => unmount(mountPath),
	checkHealth: () => checkHealth(mountPath),
});
