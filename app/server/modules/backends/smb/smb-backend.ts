import * as fs from "node:fs/promises";
import * as os from "node:os";
import { OPERATION_TIMEOUT } from "../../../core/constants";
import { cryptoUtils } from "../../../utils/crypto";
import { toMessage } from "../../../utils/errors";
import { logger } from "../../../utils/logger";
import { getMountForPath } from "../../../utils/mountinfo";
import { withTimeout } from "../../../utils/timeout";
import type { VolumeBackend } from "../backend";
import { executeMount, executeUnmount } from "../utils/backend-utils";
import { BACKEND_STATUS, type BackendConfig } from "~/schemas/volumes";

const mount = async (config: BackendConfig, path: string) => {
	logger.debug(`Mounting SMB volume ${path}...`);

	if (config.backend !== "smb") {
		logger.error("Provided config is not for SMB backend");
		return { status: BACKEND_STATUS.error, error: "Provided config is not for SMB backend" };
	}

	if (os.platform() !== "linux") {
		logger.error("SMB mounting is only supported on Linux hosts.");
		return { status: BACKEND_STATUS.error, error: "SMB mounting is only supported on Linux hosts." };
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

		const password = await cryptoUtils.resolveSecret(config.password);

		const source = `//${config.server}/${config.share}`;
		const options = [
			`user=${config.username}`,
			`pass=${password}`,
			`vers=${config.vers}`,
			`port=${config.port}`,
			"uid=1000",
			"gid=1000",
		];

		if (config.domain) {
			options.push(`domain=${config.domain}`);
		}

		if (config.readOnly) {
			options.push("ro");
		}

		const args = ["-t", "cifs", "-o", options.join(","), source, path];

		logger.debug(`Mounting SMB volume ${path}...`);
		logger.info(`Executing mount: mount ${args.join(" ")}`);

		await executeMount(args);

		logger.info(`SMB volume at ${path} mounted successfully.`);
		return { status: BACKEND_STATUS.mounted };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT, "SMB mount");
	} catch (error) {
		logger.error("Error mounting SMB volume", { error: toMessage(error) });
		return { status: BACKEND_STATUS.error, error: toMessage(error) };
	}
};

const unmount = async (path: string) => {
	if (os.platform() !== "linux") {
		logger.error("SMB unmounting is only supported on Linux hosts.");
		return { status: BACKEND_STATUS.error, error: "SMB unmounting is only supported on Linux hosts." };
	}

	const run = async () => {
		const mount = await getMountForPath(path);
		if (!mount || mount.mountPoint !== path) {
			logger.debug(`Path ${path} is not a mount point. Skipping unmount.`);
			return { status: BACKEND_STATUS.unmounted };
		}

		await executeUnmount(path);

		await fs.rmdir(path).catch(() => {});

		logger.info(`SMB volume at ${path} unmounted successfully.`);
		return { status: BACKEND_STATUS.unmounted };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT, "SMB unmount");
	} catch (error) {
		logger.error("Error unmounting SMB volume", { path, error: toMessage(error) });
		return { status: BACKEND_STATUS.error, error: toMessage(error) };
	}
};

const checkHealth = async (path: string) => {
	const run = async () => {
		try {
			await fs.access(path);
		} catch {
			throw new Error("Volume is not mounted");
		}

		const mount = await getMountForPath(path);

		if (!mount || mount.mountPoint !== path) {
			throw new Error("Volume is not mounted");
		}

		if (mount.fstype !== "cifs") {
			throw new Error(`Path ${path} is not mounted as CIFS/SMB (found ${mount.fstype}).`);
		}

		logger.debug(`SMB volume at ${path} is healthy and mounted.`);
		return { status: BACKEND_STATUS.mounted };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT, "SMB health check");
	} catch (error) {
		const message = toMessage(error);
		if (message !== "Volume is not mounted") {
			logger.error("SMB volume health check failed:", message);
		}
		return { status: BACKEND_STATUS.error, error: message };
	}
};

export const makeSmbBackend = (config: BackendConfig, path: string): VolumeBackend => ({
	mount: () => mount(config, path),
	unmount: () => unmount(path),
	checkHealth: () => checkHealth(path),
});
