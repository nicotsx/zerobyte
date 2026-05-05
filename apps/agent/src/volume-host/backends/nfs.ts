import * as fs from "node:fs/promises";
import * as os from "node:os";
import { logger } from "@zerobyte/core/node";
import { toMessage } from "@zerobyte/core/utils";
import { OPERATION_TIMEOUT } from "../constants";
import { withTimeout } from "../timeout";
import { getMountForPath } from "../fs";
import type { BackendConfig, VolumeBackend } from "../types";
import { assertMounted, executeMount, executeUnmount } from "./utils";

const checkHealth = async (mountPath: string) => {
	const run = async () => {
		await assertMounted(mountPath, (fstype) => fstype.startsWith("nfs"));

		logger.debug(`NFS volume at ${mountPath} is healthy and mounted.`);
		return { status: "mounted" as const };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT, "NFS health check");
	} catch (error) {
		const message = toMessage(error);
		if (message !== "Volume is not mounted") {
			logger.error("NFS volume health check failed:", message);
		}
		return { status: "error" as const, error: message };
	}
};

const unmount = async (mountPath: string) => {
	if (os.platform() !== "linux") {
		logger.error("NFS unmounting is only supported on Linux hosts.");
		return { status: "error" as const, error: "NFS unmounting is only supported on Linux hosts." };
	}

	const run = async () => {
		const mount = await getMountForPath(mountPath);
		if (!mount || mount.mountPoint !== mountPath) {
			logger.debug(`Path ${mountPath} is not a mount point. Skipping unmount.`);
			return { status: "unmounted" as const };
		}

		await executeUnmount(mountPath);
		await fs.rmdir(mountPath).catch(() => {});

		logger.info(`NFS volume at ${mountPath} unmounted successfully.`);
		return { status: "unmounted" as const };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT, "NFS unmount");
	} catch (error) {
		logger.error("Error unmounting NFS volume", { mountPath, error: toMessage(error) });
		return { status: "error" as const, error: toMessage(error) };
	}
};

const mount = async (config: BackendConfig, mountPath: string) => {
	logger.debug(`Mounting volume ${mountPath}...`);

	if (config.backend !== "nfs") {
		logger.error("Provided config is not for NFS backend");
		return { status: "error" as const, error: "Provided config is not for NFS backend" };
	}

	if (os.platform() !== "linux") {
		logger.error("NFS mounting is only supported on Linux hosts.");
		return { status: "error" as const, error: "NFS mounting is only supported on Linux hosts." };
	}

	const { status } = await checkHealth(mountPath);
	if (status === "mounted") return { status: "mounted" as const };

	if (status === "error") {
		logger.debug(`Trying to unmount any existing mounts at ${mountPath} before mounting...`);
		await unmount(mountPath);
	}

	const run = async () => {
		await fs.mkdir(mountPath, { recursive: true });
		const options = [`vers=${config.version}`, `port=${config.port}`];
		if (config.version === "3") options.push("nolock");
		if (config.readOnly) options.push("ro");
		const args = ["-t", "nfs", "-o", options.join(","), `${config.server}:${config.exportPath}`, mountPath];

		logger.debug(`Mounting volume ${mountPath}...`);
		logger.info(`Executing mount: mount ${args.join(" ")}`);

		try {
			await executeMount(args);
		} catch (error) {
			logger.warn(`Initial NFS mount failed, retrying with -i flag: ${toMessage(error)}`);
			await executeMount(["-i", ...args]);
		}

		logger.info(`NFS volume at ${mountPath} mounted successfully.`);
		return { status: "mounted" as const };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT, "NFS mount");
	} catch (error) {
		logger.error("Error mounting NFS volume", { error: toMessage(error) });
		return { status: "error" as const, error: toMessage(error) };
	}
};

export const makeNfsBackend = (config: BackendConfig, mountPath: string): VolumeBackend => ({
	mount: () => mount(config, mountPath),
	unmount: () => unmount(mountPath),
	checkHealth: () => checkHealth(mountPath),
});
