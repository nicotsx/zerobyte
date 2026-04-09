import * as fs from "node:fs/promises";
import * as os from "node:os";
import { OPERATION_TIMEOUT } from "../../../core/constants";
import { cryptoUtils } from "../../../utils/crypto";
import { toMessage } from "../../../utils/errors";
import { logger } from "@zerobyte/core/node";
import { getMountForPath } from "../../../utils/mountinfo";
import { withTimeout } from "../../../utils/timeout";
import type { VolumeBackend } from "../backend";
import { assertMounted, executeMount, executeUnmount } from "../utils/backend-utils";
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

		const source = `//${config.server}/${config.share}`;
		const { uid, gid } = os.userInfo();

		const options = [`port=${config.port}`, `uid=${uid}`, `gid=${gid}`, "iocharset=utf8"];

		if (config.guest) {
			options.push("username=guest", "password=");
		} else {
			const password = await cryptoUtils.resolveSecret(config.password ?? "");
			const safePassword = password.replace(/\\/g, "\\\\").replace(/,/g, "\\,");

			options.push(`username=${config.username ?? "user"}`, `password=${safePassword}`);
		}

		if (config.domain) {
			options.push(`domain=${config.domain}`);
		}

		if (config.vers && config.vers !== "auto") {
			options.push(`vers=${config.vers}`);
		}

		if (config.readOnly) {
			options.push("ro");
		}

		const args = ["-t", "cifs", "-o", options.join(","), source, path];

		logger.debug(`Mounting SMB volume ${path}...`);
		logger.info(`Executing mount: mount ${args.join(" ")}`);

		try {
			await executeMount(args);
		} catch (error) {
			logger.error(`SMB mount failed: ${toMessage(error)}`);
			throw error;
		}

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
		await assertMounted(path, (fstype) => fstype === "cifs");

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
