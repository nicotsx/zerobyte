import * as fs from "node:fs/promises";
import * as path from "node:path";
import { toMessage } from "../utils";
import { logger } from "../node";

const isNodeJSErrnoException = (error: unknown): error is NodeJS.ErrnoException =>
	error instanceof Error && "code" in error;

export const getStatFs = async (mountPoint: string) => {
	const stat = await fs.statfs(mountPoint, { bigint: true });
	const unit = stat.bsize > 0n ? stat.bsize : 1n;
	const blocks = stat.blocks > 0n ? stat.blocks : 0n;
	let bfree = stat.bfree > 0n ? stat.bfree : 0n;
	if (bfree > blocks) bfree = blocks;
	const bavail = stat.bavail > 0n ? stat.bavail : 0n;
	const max = BigInt(Number.MAX_SAFE_INTEGER);
	const toNumber = (value: bigint) => (value > max ? Number.MAX_SAFE_INTEGER : Number(value));

	return {
		total: toNumber(blocks * unit),
		used: toNumber((blocks - bfree) * unit),
		free: toNumber(bavail * unit),
	};
};

const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 500;

const realpath = async (value: string) => {
	const resolved = await fs.realpath(value);
	return process.platform === "win32" && /^[a-z]:$/i.test(resolved) ? `${resolved}\\` : resolved;
};

export const listFiles = async (
	rootPath: string,
	subPath?: string,
	offset: number = 0,
	limit: number = DEFAULT_PAGE_SIZE,
) => {
	const volumePath = rootPath;
	const requestedPath = subPath ? path.join(volumePath, subPath) : volumePath;
	const normalizedPath = path.normalize(requestedPath);
	const requestedRelativePath = path.relative(volumePath, normalizedPath);

	if (
		requestedRelativePath === ".." ||
		requestedRelativePath.startsWith(`..${path.sep}`) ||
		path.isAbsolute(requestedRelativePath)
	) {
		throw new Error("Invalid path");
	}

	const pageSize = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
	const startOffset = Math.max(offset, 0);

	try {
		const realVolumeRoot = await realpath(volumePath);
		const realRequestedPath = await realpath(requestedPath);
		const relative = path.relative(realVolumeRoot, realRequestedPath);

		if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
			throw new Error("Invalid path");
		}

		const dirents = await fs.readdir(realRequestedPath, { withFileTypes: true });

		dirents.sort((a, b) => {
			const aIsDir = a.isDirectory();
			const bIsDir = b.isDirectory();

			if (aIsDir === bIsDir) {
				return a.name.localeCompare(b.name);
			}
			return aIsDir ? -1 : 1;
		});

		const total = dirents.length;
		const paginatedDirents = dirents.slice(startOffset, startOffset + pageSize);

		const entries = (
			await Promise.all(
				paginatedDirents.map(async (dirent) => {
					const fullPath = path.join(realRequestedPath, dirent.name);

					try {
						const stats = await fs.stat(fullPath);
						const relativePath = path.relative(realVolumeRoot, fullPath);

						return {
							name: dirent.name,
							path: `/${relativePath.split(path.sep).join("/")}`,
							type: dirent.isDirectory() ? ("directory" as const) : ("file" as const),
							size: dirent.isFile() ? stats.size : undefined,
							modifiedAt: stats.mtimeMs,
						};
					} catch {
						return null;
					}
				}),
			)
		).filter((entry) => entry !== null);

		return {
			files: entries,
			path: subPath || "/",
			offset: startOffset,
			limit: pageSize,
			total,
			hasMore: startOffset + pageSize < total,
		};
	} catch (error) {
		logger.error("Failed to list directory", {
			volumePath,
			requestedPath,
			error: toMessage(error),
			code: isNodeJSErrnoException(error) ? error.code : undefined,
		});
		if (isNodeJSErrnoException(error) && error.code === "ENOENT") {
			throw new Error("Directory not found");
		}
		if (toMessage(error) === "Invalid path") {
			throw error;
		}
		throw new Error(`Failed to list files: ${toMessage(error)}`);
	}
};

export const browseFilesystem = async (browsePath: string) => {
	const normalizedPath = path.normalize(browsePath);
	const entries = await fs.readdir(normalizedPath, { withFileTypes: true });

	const directories = await Promise.all(
		entries
			.filter((entry) => entry.isDirectory())
			.map(async (entry) => {
				const fullPath = path.join(normalizedPath, entry.name);

				try {
					const stats = await fs.stat(fullPath);
					return {
						name: entry.name,
						path: fullPath,
						type: "directory" as const,
						size: undefined,
						modifiedAt: stats.mtimeMs,
					};
				} catch {
					return {
						name: entry.name,
						path: fullPath,
						type: "directory" as const,
						size: undefined,
						modifiedAt: undefined,
					};
				}
			}),
	);

	return {
		directories: directories.sort((a, b) => a.name.localeCompare(b.name)),
		path: normalizedPath,
	};
};

export type StatFs = Awaited<ReturnType<typeof getStatFs>>;
