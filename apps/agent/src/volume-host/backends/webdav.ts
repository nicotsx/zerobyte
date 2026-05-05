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
		await assertMounted(mountPath, (fstype) => fstype === "fuse" || fstype === "davfs");

		logger.debug(`WebDAV volume at ${mountPath} is healthy and mounted.`);
		return { status: "mounted" as const };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT, "WebDAV health check");
	} catch (error) {
		const message = toMessage(error);
		if (message !== "Volume is not mounted") {
			logger.error("WebDAV volume health check failed:", message);
		}
		return { status: "error" as const, error: message };
	}
};

const unmount = async (mountPath: string) => {
	if (os.platform() !== "linux") {
		logger.error("WebDAV unmounting is only supported on Linux hosts.");
		return { status: "error" as const, error: "WebDAV unmounting is only supported on Linux hosts." };
	}

	const run = async () => {
		const mount = await getMountForPath(mountPath);
		if (!mount || mount.mountPoint !== mountPath) {
			logger.debug(`Path ${mountPath} is not a mount point. Skipping unmount.`);
			return { status: "unmounted" as const };
		}

		await executeUnmount(mountPath);
		await fs.rmdir(mountPath).catch(() => {});

		logger.info(`WebDAV volume at ${mountPath} unmounted successfully.`);
		return { status: "unmounted" as const };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT, "WebDAV unmount");
	} catch (error) {
		logger.error("Error unmounting WebDAV volume", { mountPath, error: toMessage(error) });
		return { status: "error" as const, error: toMessage(error) };
	}
};

const mount = async (config: BackendConfig, mountPath: string) => {
	logger.debug(`Mounting WebDAV volume ${mountPath}...`);

	if (config.backend !== "webdav") {
		logger.error("Provided config is not for WebDAV backend");
		return { status: "error" as const, error: "Provided config is not for WebDAV backend" };
	}

	if (os.platform() !== "linux") {
		logger.error("WebDAV mounting is only supported on Linux hosts.");
		return { status: "error" as const, error: "WebDAV mounting is only supported on Linux hosts." };
	}

	const { status } = await checkHealth(mountPath);
	if (status === "mounted") return { status: "mounted" as const };

	if (status === "error") {
		logger.debug(`Trying to unmount any existing mounts at ${mountPath} before mounting...`);
		await unmount(mountPath);
	}

	const run = async () => {
		await fs.mkdir(mountPath, { recursive: true }).catch((error) => {
			logger.warn(`Failed to create directory ${mountPath}: ${toMessage(error)}`);
		});
		const protocol = config.ssl ? "https" : "http";
		const defaultPort = config.ssl ? 443 : 80;
		const source = `${protocol}://${config.server}${config.port !== defaultPort ? `:${config.port}` : ""}${config.path}`;
		const { uid, gid } = os.userInfo();
		const options = config.readOnly
			? [`uid=${uid}`, `gid=${gid}`, "file_mode=0444", "dir_mode=0555", "ro"]
			: [`uid=${uid}`, `gid=${gid}`, "file_mode=0664", "dir_mode=0775"];

		if (config.username && config.password) {
			const entry = [source, config.username, config.password]
				.map((value) => value.replace(/[\r\n\t\s]+/g, " "))
				.join(" ");
			await fs.appendFile("/etc/davfs2/secrets", `${entry}\n`, { mode: 0o600 });
		}

		logger.debug(`Mounting WebDAV volume ${mountPath}...`);

		const args = ["-t", "davfs", "-o", options.join(","), source, mountPath];
		try {
			await executeMount(args);
		} catch (error) {
			logger.warn(`Initial WebDAV mount failed, retrying with -i flag: ${toMessage(error)}`);
			await executeMount(["-i", ...args]);
		}

		logger.info(`WebDAV volume at ${mountPath} mounted successfully.`);
		return { status: "mounted" as const };
	};

	try {
		return await withTimeout(run(), OPERATION_TIMEOUT, "WebDAV mount");
	} catch (error) {
		const message = toMessage(error);
		if (message.includes("already mounted")) return { status: "mounted" as const };

		logger.error("Error mounting WebDAV volume", { error: message });

		if (message.includes("option") && message.includes("requires argument")) {
			return {
				status: "error" as const,
				error: "Invalid mount options. Please check your WebDAV server configuration.",
			};
		}
		if (message.includes("connection refused") || message.includes("Connection refused")) {
			return {
				status: "error" as const,
				error: "Cannot connect to WebDAV server. Please check the server address and port.",
			};
		}
		if (message.includes("unauthorized") || message.includes("Unauthorized")) {
			return { status: "error" as const, error: "Authentication failed. Please check your username and password." };
		}

		return { status: "error" as const, error: message };
	}
};

export const makeWebdavBackend = (config: BackendConfig, mountPath: string): VolumeBackend => ({
	mount: () => mount(config, mountPath),
	unmount: () => unmount(mountPath),
	checkHealth: () => checkHealth(mountPath),
});
