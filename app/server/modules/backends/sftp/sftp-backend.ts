import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { $ } from "bun";
import { OPERATION_TIMEOUT } from "../../../core/constants";
import { cryptoUtils } from "../../../utils/crypto";
import { toMessage } from "../../../utils/errors";
import { logger } from "../../../utils/logger";
import { getMountForPath } from "../../../utils/mountinfo";
import { withTimeout } from "../../../utils/timeout";
import type { VolumeBackend } from "../backend";
import { executeUnmount } from "../utils/backend-utils";
import { BACKEND_STATUS, type BackendConfig } from "~/schemas/volumes";

const SSH_KEYS_DIR = "/var/lib/zerobyte/ssh";

const getPrivateKeyPath = (mountPath: string) => {
	const name = path.basename(mountPath);
	return path.join(SSH_KEYS_DIR, `${name}.key`);
};

const mount = async (config: BackendConfig, mountPath: string) => {
	logger.debug(`Mounting SFTP volume ${mountPath}...`);

	if (config.backend !== "sftp") {
		logger.error("Provided config is not for SFTP backend");
		return { status: BACKEND_STATUS.error, error: "Provided config is not for SFTP backend" };
	}

	if (os.platform() !== "linux") {
		logger.error("SFTP mounting is only supported on Linux hosts.");
		return { status: BACKEND_STATUS.error, error: "SFTP mounting is only supported on Linux hosts." };
	}

	const { status } = await checkHealth(mountPath);
	if (status === "mounted") {
		return { status: BACKEND_STATUS.mounted };
	}

	if (status === "error") {
		logger.debug(`Trying to unmount any existing mounts at ${mountPath} before mounting...`);
		await unmount(mountPath);
	}

	const run = async () => {
		await fs.mkdir(mountPath, { recursive: true });
		await fs.mkdir(SSH_KEYS_DIR, { recursive: true });

		const options = [
			"reconnect",
			"ServerAliveInterval=15",
			"ServerAliveCountMax=3",
			"allow_other",
			"StrictHostKeyChecking=no",
			"UserKnownHostsFile=/dev/null",
			"uid=1000",
			"gid=1000",
		];

		if (config.readOnly) {
			options.push("ro");
		}

		if (config.port) {
			options.push(`port=${config.port}`);
		}

		const keyPath = getPrivateKeyPath(mountPath);
		if (config.privateKey) {
			const decryptedKey = await cryptoUtils.resolveSecret(config.privateKey);
			let normalizedKey = decryptedKey.replace(/\r\n/g, "\n");
			if (!normalizedKey.endsWith("\n")) {
				normalizedKey += "\n";
			}
			await fs.writeFile(keyPath, normalizedKey, { mode: 0o600 });
			options.push(`IdentityFile=${keyPath}`);
		}

		const source = `${config.username}@${config.host}:${config.path || ""}`;
		const args = [source, mountPath, "-o", options.join(",")];

		logger.debug(`Mounting SFTP volume ${mountPath}...`);

		let result: $.ShellOutput;
		if (config.password) {
			const password = await cryptoUtils.resolveSecret(config.password);
			args.push("-o", "password_stdin");
			logger.info(`Executing sshfs: echo "******" | sshfs ${args.join(" ")}`);
			result = await $`echo ${password} | sshfs ${args}`.nothrow();
		} else {
			logger.info(`Executing sshfs: sshfs ${args.join(" ")}`);
			result = await $`sshfs ${args}`.nothrow();
		}

		if (result.exitCode !== 0) {
			const errorMsg = result.stderr.toString() || result.stdout.toString() || "Unknown error";
			throw new Error(`Failed to mount SFTP volume: ${errorMsg}`);
		}

		logger.info(`SFTP volume at ${mountPath} mounted successfully.`);
		return { status: BACKEND_STATUS.mounted };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT, "SFTP mount");
	} catch (error) {
		const errorMsg = toMessage(error);
		logger.error("Error mounting SFTP volume", { error: errorMsg });
		return { status: BACKEND_STATUS.error, error: errorMsg };
	}
};

const unmount = async (mountPath: string) => {
	if (os.platform() !== "linux") {
		logger.error("SFTP unmounting is only supported on Linux hosts.");
		return { status: BACKEND_STATUS.error, error: "SFTP unmounting is only supported on Linux hosts." };
	}

	const run = async () => {
		const mount = await getMountForPath(mountPath);
		if (!mount || mount.mountPoint !== mountPath) {
			logger.debug(`Path ${mountPath} is not a mount point. Skipping unmount.`);
		} else {
			await executeUnmount(mountPath);
		}

		const keyPath = getPrivateKeyPath(mountPath);
		await fs.unlink(keyPath).catch(() => {});
		await fs.rmdir(mountPath).catch(() => {});

		logger.info(`SFTP volume at ${mountPath} unmounted successfully.`);
		return { status: BACKEND_STATUS.unmounted };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT, "SFTP unmount");
	} catch (error) {
		logger.error("Error unmounting SFTP volume", { mountPath, error: toMessage(error) });
		return { status: BACKEND_STATUS.error, error: toMessage(error) };
	}
};

const checkHealth = async (mountPath: string) => {
	const mount = await getMountForPath(mountPath);

	if (!mount || mount.mountPoint !== mountPath) {
		return { status: BACKEND_STATUS.unmounted };
	}

	if (mount.fstype !== "fuse.sshfs") {
		return {
			status: BACKEND_STATUS.error,
			error: `Invalid filesystem type: ${mount.fstype} (expected fuse.sshfs)`,
		};
	}

	return { status: BACKEND_STATUS.mounted };
};

export const makeSftpBackend = (config: BackendConfig, mountPath: string): VolumeBackend => ({
	mount: () => mount(config, mountPath),
	unmount: () => unmount(mountPath),
	checkHealth: () => checkHealth(mountPath),
});
