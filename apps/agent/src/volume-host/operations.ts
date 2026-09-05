import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { BackendConfig, Volume as AgentVolume } from "@zerobyte/contracts/volumes";
import { toMessage } from "@zerobyte/core/utils";
import { logger } from "@zerobyte/core/node";
import { Data, Effect } from "effect";
import { createVolumeBackend, isNodeJSErrnoException } from ".";
import type { ResolvedFileListingSource } from "../execution-policy";
import { serializeFilesystemPath } from "../trusted-source-presentation";

const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 500;

const realpath = async (value: string) => {
	const resolved = await fs.realpath(value);
	return process.platform === "win32" && /^[a-z]:$/i.test(resolved) ? `${resolved}\\` : resolved;
};

export const listVolumeFiles = async (
	source: ResolvedFileListingSource,
	offset: number = 0,
	limit: number = DEFAULT_PAGE_SIZE,
) => {
	const volumePath = source.canonicalPath;
	const requestedSubPath = source.requestedSubPath;
	const requestedPath = requestedSubPath ? path.join(volumePath, requestedSubPath) : volumePath;
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
						const relativePath = serializeFilesystemPath(path.relative(realVolumeRoot, fullPath));

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

		let responsePath = "/";
		if (source.responsePathStyle === "source-relative" && requestedRelativePath) {
			responsePath = `/${serializeFilesystemPath(requestedRelativePath)}`;
		} else if (source.responsePathStyle === "legacy" && requestedSubPath) {
			responsePath = serializeFilesystemPath(requestedSubPath);
		}
		return {
			files: entries,
			path: responsePath,
			offset: startOffset,
			limit: pageSize,
			total,
			hasMore: startOffset + pageSize < total,
		};
	} catch (error) {
		logger.error("Failed to list volume directory", {
			volumeId: source.sourceId,
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
		console.error(`Failed to list trusted source files: ${toMessage(error)}`);
		throw new Error("Failed to list files");
	}
};

export const browseFilesystem = async (browsePath: string, trustedRootPath?: string) => {
	const normalizedPath = path.normalize(browsePath);
	let entries: Dirent[];
	try {
		entries = await fs.readdir(normalizedPath, { withFileTypes: true });
	} catch (error) {
		console.error(`Failed to browse trusted source: ${toMessage(error)}`);
		throw new Error("Failed to browse filesystem");
	}

	const directories = await Promise.all(
		entries
			.filter((entry) => entry.isDirectory())
			.map(async (entry) => {
				const fullPath = path.join(normalizedPath, entry.name);

				try {
					const stats = await fs.stat(fullPath);
					const relativePath = trustedRootPath ? path.relative(trustedRootPath, fullPath) : fullPath;
					const portableRelativePath = serializeFilesystemPath(relativePath);
					const displayPath =
						trustedRootPath && portableRelativePath
							? `/${portableRelativePath}`
							: portableRelativePath || "/";
					return {
						name: entry.name,
						path: displayPath,
						type: "directory" as const,
						size: undefined,
						modifiedAt: stats.mtimeMs,
					};
				} catch {
					const relativePath = trustedRootPath ? path.relative(trustedRootPath, fullPath) : fullPath;
					const portableRelativePath = serializeFilesystemPath(relativePath);
					const displayPath =
						trustedRootPath && portableRelativePath
							? `/${portableRelativePath}`
							: portableRelativePath || "/";
					return {
						name: entry.name,
						path: displayPath,
						type: "directory" as const,
						size: undefined,
						modifiedAt: undefined,
					};
				}
			}),
	);

	const relativeBrowsePath = trustedRootPath ? path.relative(trustedRootPath, normalizedPath) : normalizedPath;
	const displayBrowsePath = serializeFilesystemPath(relativeBrowsePath) || "/";
	return {
		directories: directories.sort((a, b) => a.name.localeCompare(b.name)),
		path: displayBrowsePath,
	};
};

class TempDirError extends Data.TaggedError("TempDirError")<{
	cause: unknown;
}> {}

class CleanupError extends Data.TaggedError("CleanupError")<{
	cause: unknown;
	tempDir: string;
}> {}

class MountError extends Data.TaggedError("MountError")<{
	cause: unknown;
}> {}

const createTempDir = Effect.acquireRelease(
	Effect.tryPromise({
		try: () => fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-test-")),
		catch: (error) => new TempDirError({ cause: error }),
	}),
	(tempDir) =>
		Effect.tryPromise({
			try: () => fs.rm(tempDir, { recursive: true, force: true }),
			catch: (error) => new CleanupError({ cause: error, tempDir }),
		}).pipe(Effect.orDie),
);

export const testVolumeConnection = (backendConfig: BackendConfig) =>
	Effect.scoped(
		Effect.gen(function* () {
			const tempDir = yield* createTempDir;

			const mockVolume: AgentVolume = {
				id: 0,
				shortId: "test",
				name: "test-connection",
				config: backendConfig,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				lastHealthCheck: Date.now(),
				type: backendConfig.backend,
				status: "unmounted",
				lastError: null,
				provisioningId: null,
				autoRemount: true,
				agentId: "local",
				organizationId: "test-org",
				sourceKind: "managed",
				trustedRootId: null,
				relativePath: null,
			};

			const backend = createVolumeBackend(mockVolume, tempDir);

			const mountResult = yield* Effect.tryPromise({
				try: () => backend.mount(),
				catch: (error) => new MountError({ cause: error }),
			});

			yield* Effect.tryPromise({
				try: () => backend.unmount(),
				catch: () => undefined,
			});

			return {
				success: !mountResult.error,
				message: mountResult.error ? toMessage(mountResult.error) : "Connection successful",
			};
		}),
	);
