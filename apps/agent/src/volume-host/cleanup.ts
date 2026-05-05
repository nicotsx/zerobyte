import * as fs from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@zerobyte/core/node";
import { toMessage } from "@zerobyte/core/utils";
import { VOLUME_MOUNT_BASE } from "./constants";
import { readMountInfo } from "./fs";

export const cleanupDanglingVolumeMountDirectories = async () => {
	const mounts = await readMountInfo().catch((error) => {
		logger.warn(`Failed to read mount info for volume cleanup: ${toMessage(error)}`);
		return [];
	});
	const mountedPaths = new Set(mounts.map((mount) => mount.mountPoint));
	const volumeDirs = await fs.readdir(VOLUME_MOUNT_BASE).catch(() => []);

	for (const dir of volumeDirs) {
		const mountPath = path.join(VOLUME_MOUNT_BASE, dir, "_data");
		if (mountedPaths.has(mountPath)) {
			continue;
		}

		const fullPath = path.join(VOLUME_MOUNT_BASE, dir);
		logger.info(`Removing stale volume mount directory at ${fullPath}`);
		await fs.rm(fullPath, { recursive: true, force: true }).catch((error) => {
			logger.warn(`Failed to remove stale volume mount directory ${fullPath}: ${toMessage(error)}`);
		});
	}
};
