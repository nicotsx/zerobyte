import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { FILE_MODES, logger, writeFileWithMode } from "@zerobyte/core/node";
import { toMessage } from "@zerobyte/core/utils";
import { OPERATION_TIMEOUT, SSH_KEYS_DIR } from "../constants";
import { getMountForPath } from "../fs";
import { withTimeout } from "../timeout";
import type { BackendConfig, VolumeBackend } from "../types";
import { executeUnmount } from "./utils";

const getMountPathHash = (mountPath: string) => createHash("sha256").update(mountPath).digest("hex").slice(0, 16);
const getPrivateKeyPath = (mountPath: string) => path.join(SSH_KEYS_DIR, `${getMountPathHash(mountPath)}.key`);
const getKnownHostsPath = (mountPath: string) => path.join(SSH_KEYS_DIR, `${getMountPathHash(mountPath)}.known_hosts`);

const runSshfs = async (args: string[], password?: string) =>
	new Promise<void>((resolve, reject) => {
		const child = spawn("sshfs", args, { stdio: ["pipe", "pipe", "pipe"] });
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

		if (password) child.stdin.write(password);
		child.stdin.end();
	});

const checkHealth = async (mountPath: string) => {
	const mount = await getMountForPath(mountPath);
	if (!mount || mount.mountPoint !== mountPath) return { status: "unmounted" as const };
	if (mount.fstype !== "fuse.sshfs") {
		return { status: "error" as const, error: `Invalid filesystem type: ${mount.fstype} (expected fuse.sshfs)` };
	}
	return { status: "mounted" as const };
};

const unmount = async (mountPath: string) => {
	if (os.platform() !== "linux") {
		logger.error("SFTP unmounting is only supported on Linux hosts.");
		return { status: "error" as const, error: "SFTP unmounting is only supported on Linux hosts." };
	}

	const run = async () => {
		const mount = await getMountForPath(mountPath);
		if (!mount || mount.mountPoint !== mountPath) {
			logger.debug(`Path ${mountPath} is not a mount point. Skipping unmount.`);
		} else {
			await executeUnmount(mountPath);
		}

		await fs.unlink(getPrivateKeyPath(mountPath)).catch(() => {});
		await fs.unlink(getKnownHostsPath(mountPath)).catch(() => {});
		await fs.rmdir(mountPath).catch(() => {});

		logger.info(`SFTP volume at ${mountPath} unmounted successfully.`);
		return { status: "unmounted" as const };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT, "SFTP unmount");
	} catch (error) {
		logger.error("Error unmounting SFTP volume", { mountPath, error: toMessage(error) });
		return { status: "error" as const, error: toMessage(error) };
	}
};

const mount = async (config: BackendConfig, mountPath: string) => {
	logger.debug(`Mounting SFTP volume ${mountPath}...`);

	if (config.backend !== "sftp") {
		logger.error("Provided config is not for SFTP backend");
		return { status: "error" as const, error: "Provided config is not for SFTP backend" };
	}

	if (os.platform() !== "linux") {
		logger.error("SFTP mounting is only supported on Linux hosts.");
		return { status: "error" as const, error: "SFTP mounting is only supported on Linux hosts." };
	}

	const { status } = await checkHealth(mountPath);
	if (status === "mounted") return { status: "mounted" as const };

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

		if (config.skipHostKeyCheck) {
			options.push("StrictHostKeyChecking=no", "UserKnownHostsFile=/dev/null");
		} else if (config.knownHosts) {
			await writeFileWithMode(getKnownHostsPath(mountPath), config.knownHosts, FILE_MODES.ownerReadWrite);
			options.push(`UserKnownHostsFile=${getKnownHostsPath(mountPath)}`, "StrictHostKeyChecking=yes");
		} else {
			options.push("StrictHostKeyChecking=yes");
		}

		if (config.readOnly) options.push("ro");
		if (config.port) options.push(`port=${config.port}`);
		if (config.privateKey) {
			let key = config.privateKey.replace(/\r\n/g, "\n");
			if (!key.endsWith("\n")) key += "\n";
			await writeFileWithMode(getPrivateKeyPath(mountPath), key, FILE_MODES.ownerReadWrite);
			options.push(`IdentityFile=${getPrivateKeyPath(mountPath)}`);
		}

		const args = [`${config.username}@${config.host}:${config.path || ""}`, mountPath, "-o", options.join(",")];
		if (config.password) args.push("-o", "password_stdin");
		logger.info(`Executing sshfs: sshfs ${args.join(" ")}`);
		await runSshfs(args, config.password);

		logger.info(`SFTP volume at ${mountPath} mounted successfully.`);
		return { status: "mounted" as const };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT * 2, "SFTP mount");
	} catch (error) {
		logger.error("Error mounting SFTP volume", { error: toMessage(error) });
		return { status: "error" as const, error: toMessage(error) };
	}
};

export const makeSftpBackend = (config: BackendConfig, mountPath: string): VolumeBackend => ({
	mount: () => mount(config, mountPath),
	unmount: () => unmount(mountPath),
	checkHealth: () => checkHealth(mountPath),
});
