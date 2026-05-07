import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { toMessage } from "@zerobyte/core/utils";
import { createVolumeBackend, getVolumePath, isNodeJSErrnoException } from ".";
import type { AgentVolume, BackendConfig } from "./types";
import { Data, Effect } from "effect";

const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 500;

export const listVolumeFiles = async (
	volume: AgentVolume,
	subPath?: string,
	offset: number = 0,
	limit: number = DEFAULT_PAGE_SIZE,
) => {
	const volumePath = getVolumePath(volume);
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
		const realVolumeRoot = await fs.realpath(volumePath);
		const realRequestedPath = await fs.realpath(requestedPath);
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
							path: `/${relativePath}`,
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
