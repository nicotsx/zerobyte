import * as fs from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@zerobyte/core/node";
import { isPathWithin, toMessage } from "@zerobyte/core/utils";
import { db } from "../../../db/db";
import { LOCAL_AGENT_ID } from "../../agents/constants";
import { VOLUME_MOUNT_BASE } from "./constants";
import { isNodeJSErrnoException, readMountInfo } from "./fs";
import { executeUnmount } from "./backends/utils";
import { getVolumePath } from "../helpers";

const resolveSavedPath = async (savedPath: string): Promise<string> => {
	if (savedPath.split(path.sep).includes(".."))
		throw new Error("Cannot safely resolve saved source with parent traversal");

	try {
		return await fs.realpath(savedPath);
	} catch (error) {
		if (!isNodeJSErrnoException(error) || error.code !== "ENOENT") throw error;

		const entry = await fs.lstat(savedPath).catch((inspectionError: unknown) => {
			if (isNodeJSErrnoException(inspectionError) && inspectionError.code === "ENOENT") return undefined;
			throw inspectionError;
		});
		const parentPath = path.dirname(savedPath);
		if (entry || parentPath === savedPath) throw error;

		return path.join(await resolveSavedPath(parentPath), path.basename(savedPath));
	}
};

const hasSavedSource = async (fullPath: string) => {
	const volumes = await db.query.volumesTable.findMany({ where: { agentId: LOCAL_AGENT_ID } });
	const savedPaths = volumes.map((volume) => getVolumePath(volume));

	if (
		savedPaths.some((savedPath) => {
			const lexicalPath = path.resolve(savedPath);
			return isPathWithin(fullPath, lexicalPath) || isPathWithin(lexicalPath, fullPath);
		})
	) {
		return true;
	}

	const canonicalPath = await fs.realpath(fullPath);

	for (const savedPath of savedPaths) {
		const canonicalSavedPath = await resolveSavedPath(savedPath);
		if (isPathWithin(canonicalPath, canonicalSavedPath) || isPathWithin(canonicalSavedPath, canonicalPath)) {
			return true;
		}
	}

	return false;
};

const isRealDirectory = async (directory: string) => {
	const stat = await fs.lstat(directory).catch((error: unknown) => {
		if (isNodeJSErrnoException(error) && error.code === "ENOENT") return undefined;
		throw error;
	});

	return stat?.isDirectory() === true;
};

export const cleanupDanglingVolumeMountDirectories = async () => {
	await readMountInfo();
	if (!(await isRealDirectory(VOLUME_MOUNT_BASE))) return;

	const volumeDirs = await fs.readdir(VOLUME_MOUNT_BASE, { withFileTypes: true });

	for (const dir of volumeDirs) {
		if (!dir.isDirectory()) continue;

		const fullPath = path.resolve(VOLUME_MOUNT_BASE, dir.name);
		const mountPath = path.join(fullPath, "_data");

		try {
			const mounts = await readMountInfo();
			const containedMounts = mounts.filter((mount) => isPathWithin(fullPath, path.resolve(mount.mountPoint)));

			if (containedMounts.length > 0) {
				if (!/^[A-Za-z0-9_-]{8}$/.test(dir.name) || containedMounts.length !== 1) continue;
				if (containedMounts[0]?.mountPoint !== mountPath) continue;
				if (!(await isRealDirectory(VOLUME_MOUNT_BASE))) continue;
				if (!(await isRealDirectory(fullPath)) || !(await isRealDirectory(mountPath))) continue;
				if (await hasSavedSource(fullPath)) continue;

				await executeUnmount(mountPath);
				const remainingMounts = await readMountInfo();
				if (remainingMounts.some((mount) => isPathWithin(fullPath, path.resolve(mount.mountPoint)))) continue;
			}

			if (!(await isRealDirectory(VOLUME_MOUNT_BASE)) || !(await isRealDirectory(fullPath))) continue;
			if (await hasSavedSource(fullPath)) continue;

			await fs.rmdir(mountPath).catch((error: unknown) => {
				if (!isNodeJSErrnoException(error) || error.code !== "ENOENT") throw error;
			});
			await fs.rmdir(fullPath);
			logger.info(`Removed stale volume mount directory at ${fullPath}`);
		} catch (error) {
			logger.warn(`Failed to remove stale volume mount directory ${fullPath}: ${toMessage(error)}`);
		}
	}
};
