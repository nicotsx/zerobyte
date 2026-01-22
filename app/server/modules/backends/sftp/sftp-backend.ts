import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
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

const getKnownHostsPath = (mountPath: string) => {
	const name = path.basename(mountPath);
	return path.join(SSH_KEYS_DIR, `${name}.known_hosts`);
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

		const { uid, gid } = os.userInfo();
		const options = [
			"reconnect",
			"ServerAliveInterval=15",
			"ServerAliveCountMax=3",
			"allow_other",
			`uid=${uid}`,
			`gid=${gid}`,
		];

		if (config.skipHostKeyCheck || !config.knownHosts) {
			options.push("StrictHostKeyChecking=no", "UserKnownHostsFile=/dev/null");
		} else if (config.knownHosts) {
			const knownHostsPath = getKnownHostsPath(mountPath);
			await fs.writeFile(knownHostsPath, config.knownHosts, { mode: 0o600 });
			options.push(`UserKnownHostsFile=${knownHostsPath}`, "StrictHostKeyChecking=yes");
		}

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

		const runSshfs = async (mountArgs: string[], password?: string) => {
			return new Promise<void>((resolve, reject) => {
				const child = spawn("sshfs", mountArgs, { stdio: ["pipe", "pipe", "pipe"] });
				let stdout = "";
				let stderr = "";

				child.stdout.setEncoding("utf8");
				child.stderr.setEncoding("utf8");

				child.stdout.on("data", (data) => {
					stdout += data;
				});

				child.stderr.on("data", (data) => {
					stderr += data;
				});

				child.on("error", (error) => {
					reject(new Error(`Failed to start sshfs: ${error.message}`));
				});

				child.on("close", (code) => {
					if (code === 0) {
						resolve();
						return;
					}

					const errorMsg = stderr.trim() || stdout.trim() || "Unknown error";
					reject(new Error(`Failed to mount SFTP volume: ${errorMsg}`));
				});

				if (password) {
					child.stdin.write(password);
				}
				child.stdin.end();
			});
		};

		if (config.password) {
			const password = await cryptoUtils.resolveSecret(config.password);
			args.push("-o", "password_stdin");
			logger.info(`Executing sshfs: sshfs ${args.join(" ")}`);
			await runSshfs(args, password);
		} else {
			logger.info(`Executing sshfs: sshfs ${args.join(" ")}`);
			await runSshfs(args);
		}

		logger.info(`SFTP volume at ${mountPath} mounted successfully.`);
		return { status: BACKEND_STATUS.mounted };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT * 2, "SFTP mount");
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

		const knownHostsPath = getKnownHostsPath(mountPath);
		await fs.unlink(knownHostsPath).catch(() => {});

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
