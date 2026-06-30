import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { BackendConfig, Volume as AgentVolume } from "@zerobyte/contracts/volumes";
import { toMessage } from "@zerobyte/core/utils";
import { Data, Effect } from "effect";
import { createVolumeBackend, getVolumePath, isNodeJSErrnoException } from ".";

const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 500;

type VolumePathResolution = {
	requestPath: string;
	nativePath: string;
	relativeRoot: string;
};

const encodeVolumePath = (segments: string[]) => {
	return segments.length ? `/${segments.map(encodeURIComponent).join("/")}` : "/";
};

const parseVolumeRequestPath = (value: string) => {
	if (!value.startsWith("/")) {
		throw new Error("Invalid path");
	}

	const segments: string[] = [];
	for (const segment of value.split("/")) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			segments.pop();
			continue;
		}

		try {
			segments.push(decodeURIComponent(segment));
		} catch {
			throw new Error("Invalid path");
		}
	}

	return segments;
};

const assertPathIsWithinRoot = (rootPath: string, targetPath: string) => {
	const relativePath = path.relative(rootPath, targetPath);

	if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
		throw new Error("Invalid path");
	}

	return relativePath;
};

const toVolumePath = (nativeRelativePath: string) => {
	const segments = nativeRelativePath.split(path.sep).filter(Boolean).map(encodeURIComponent);
	return segments.length ? `/${segments.join("/")}` : "/";
};

const assertPathHasNoSymlinkSegments = async (rootPath: string, relativePath: string) => {
	let currentPath = rootPath;
	for (const segment of relativePath.split(path.sep).filter(Boolean)) {
		currentPath = path.join(currentPath, segment);
		const stats = await fs.lstat(currentPath);
		if (stats.isSymbolicLink()) {
			throw new Error("Invalid path");
		}
	}
};

const resolveVolumeRequestPath = async (volumePath: string, subPath?: string): Promise<VolumePathResolution> => {
	const segments = parseVolumeRequestPath(subPath?.length ? subPath : "/");
	const requestPath = encodeVolumePath(segments);
	const nativePath = path.normalize(path.join(volumePath, ...segments));
	const requestedRelativePath = assertPathIsWithinRoot(volumePath, nativePath);
	const realVolumeRoot = await fs.realpath(volumePath);

	try {
		const realRequestedPath = await fs.realpath(nativePath);
		assertPathIsWithinRoot(realVolumeRoot, realRequestedPath);
		return { requestPath, nativePath: realRequestedPath, relativeRoot: realVolumeRoot };
	} catch (error) {
		if (!isNodeJSErrnoException(error) || error.code !== "ENOENT") {
			throw error;
		}

		await fs.lstat(nativePath);
		await assertPathHasNoSymlinkSegments(volumePath, requestedRelativePath);
		return { requestPath, nativePath, relativeRoot: volumePath };
	}
};

export const listVolumeFiles = async (
	volume: AgentVolume,
	subPath?: string,
	offset: number = 0,
	limit: number = DEFAULT_PAGE_SIZE,
) => {
	const volumePath = getVolumePath(volume);
	const pageSize = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
	const startOffset = Math.max(offset, 0);

	try {
		const resolvedPath = await resolveVolumeRequestPath(volumePath, subPath);
		const dirents = await fs.readdir(resolvedPath.nativePath, { withFileTypes: true });

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
					const fullPath = path.join(resolvedPath.nativePath, dirent.name);

					try {
						const stats = await fs.stat(fullPath);
						const relativePath = path.relative(resolvedPath.relativeRoot, fullPath);

						return {
							name: dirent.name,
							path: toVolumePath(relativePath),
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
			path: resolvedPath.requestPath,
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
