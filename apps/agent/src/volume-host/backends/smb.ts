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
		await assertMounted(mountPath, (fstype) => fstype === "cifs");

		logger.debug(`SMB volume at ${mountPath} is healthy and mounted.`);
		return { status: "mounted" as const };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT, "SMB health check");
	} catch (error) {
		const message = toMessage(error);
		if (message !== "Volume is not mounted") {
			logger.error("SMB volume health check failed:", message);
		}
		return { status: "error" as const, error: message };
	}
};

const unmount = async (mountPath: string) => {
	if (os.platform() !== "linux") {
		logger.error("SMB unmounting is only supported on Linux hosts.");
		return { status: "error" as const, error: "SMB unmounting is only supported on Linux hosts." };
	}

	const run = async () => {
		const mount = await getMountForPath(mountPath);
		if (!mount || mount.mountPoint !== mountPath) {
			logger.debug(`Path ${mountPath} is not a mount point. Skipping unmount.`);
			return { status: "unmounted" as const };
		}

		await executeUnmount(mountPath);
		await fs.rmdir(mountPath).catch(() => {});

		logger.info(`SMB volume at ${mountPath} unmounted successfully.`);
		return { status: "unmounted" as const };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT, "SMB unmount");
	} catch (error) {
		logger.error("Error unmounting SMB volume", { mountPath, error: toMessage(error) });
		return { status: "error" as const, error: toMessage(error) };
	}
};

const mount = async (config: BackendConfig, mountPath: string) => {
	logger.debug(`Mounting SMB volume ${mountPath}...`);

	if (config.backend !== "smb") {
		logger.error("Provided config is not for SMB backend");
		return { status: "error" as const, error: "Provided config is not for SMB backend" };
	}

	if (os.platform() !== "linux") {
		logger.error("SMB mounting is only supported on Linux hosts.");
		return { status: "error" as const, error: "SMB mounting is only supported on Linux hosts." };
	}

	const { status } = await checkHealth(mountPath);
	if (status === "mounted") return { status: "mounted" as const };

	if (status === "error") {
		logger.debug(`Trying to unmount any existing mounts at ${mountPath} before mounting...`);
		await unmount(mountPath);
	}

	const run = async () => {
		await fs.mkdir(mountPath, { recursive: true });
		const { uid, gid } = os.userInfo();
		const options = [`port=${config.port}`, `uid=${uid}`, `gid=${gid}`, "iocharset=utf8"];

		if (config.guest) {
			options.push("username=guest", "password=");
		} else {
			const safePassword = (config.password ?? "").replace(/\\/g, "\\\\").replace(/,/g, "\\,");
			options.push(`username=${config.username ?? "user"}`, `password=${safePassword}`);
		}

		if (config.domain) options.push(`domain=${config.domain}`);
		if (config.vers && config.vers !== "auto") options.push(`vers=${config.vers}`);
		if (config.readOnly) options.push("ro");

		const source = `//${config.server}/${config.share}`;
		const args = ["-t", "cifs", "-o", options.join(","), source, mountPath];

		logger.debug(`Mounting SMB volume ${mountPath}...`);
		logger.info(`Executing SMB mount for ${source} at ${mountPath}`);

		try {
			await executeMount(args);
		} catch (error) {
			logger.error(`SMB mount failed: ${toMessage(error)}`);
			throw error;
		}

		logger.info(`SMB volume at ${mountPath} mounted successfully.`);
		return { status: "mounted" as const };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT, "SMB mount");
	} catch (error) {
		logger.error("Error mounting SMB volume", { error: toMessage(error) });
		return { status: "error" as const, error: toMessage(error) };
	}
};

export const makeSmbBackend = (config: BackendConfig, mountPath: string): VolumeBackend => ({
	mount: () => mount(config, mountPath),
	unmount: () => unmount(mountPath),
	checkHealth: () => checkHealth(mountPath),
});
