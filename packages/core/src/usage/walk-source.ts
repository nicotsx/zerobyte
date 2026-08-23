import fs from "node:fs/promises";
import type { Dir, Dirent, Stats } from "node:fs";
import type { UsageFold } from "./fold.js";

export class UsageWalkCancelledError extends Error {
	constructor(message = "Usage walk cancelled") {
		super(message);
		this.name = "UsageWalkCancelledError";
	}
}

export type WalkSourceProgress = {
	nodesScanned: number;
	currentPath: string;
};

export type WalkSourceOptions = {
	/** Absolute path to walk. */
	root: string;
	fold: UsageFold;
	signal?: AbortSignal;
	/** Skip directories that sit on a different filesystem than the root. */
	oneFileSystem?: boolean;
	onProgress?: (progress: WalkSourceProgress) => void;
	progressIntervalMs?: number;
};

const joinPath = (dir: string, name: string) => (dir === "/" ? `/${name}` : `${dir}/${name}`);

const mtimeOf = (stats: Stats) => {
	const value = stats.mtimeMs;
	return Number.isFinite(value) ? Math.trunc(value) : 0;
};

/**
 * Walks a locally mounted directory tree depth-first, feeding a usage fold.
 *
 * This is what runs at backup time: the source is already mounted and the inode
 * cache is warm from restic's own pass, so it costs nothing at the repository —
 * which matters on backends that bill per request or per byte read.
 *
 * Symlinks are never followed; they are recorded as the links themselves, the
 * way restic stores them. Entries that cannot be read are counted and skipped
 * rather than aborting the walk, since a live source changes underneath us.
 */
export const walkSource = async (options: WalkSourceOptions): Promise<void> => {
	const { root, fold, signal, oneFileSystem = false, onProgress, progressIntervalMs = 1000 } = options;

	let nodesScanned = 0;
	let lastProgressAt = 0;

	const throwIfCancelled = () => {
		if (signal?.aborted) throw new UsageWalkCancelledError();
	};

	const reportProgress = (currentPath: string) => {
		if (!onProgress) return;

		const now = Date.now();
		if (now - lastProgressAt < progressIntervalMs) return;

		lastProgressAt = now;
		onProgress({ nodesScanned, currentPath });
	};

	const rootStats = await fs.lstat(root);

	if (!rootStats.isDirectory()) {
		fold.push({ path: root, type: "file", size: rootStats.size, mtime: mtimeOf(rootStats) });
		return;
	}

	const rootDevice = rootStats.dev;

	fold.push({ path: root, type: "dir", mtime: mtimeOf(rootStats) });

	/**
	 * One open directory handle per level of the current path. `opendir` streams
	 * entries instead of materialising them, so a directory with a million
	 * children costs a buffer rather than a million Dirents — and an explicit
	 * stack keeps a deep tree from exhausting the call stack.
	 */
	const stack: { path: string; handle: Dir }[] = [];

	// Bun's Dir.close() returns undefined rather than a promise, so this cannot
	// be written as `handle.close().catch(...)`.
	const closeDir = async (handle: Dir) => {
		try {
			await handle.close();
		} catch {
			// Already closed, or the handle died with the directory.
		}
	};

	const openDir = async (path: string) => {
		try {
			const handle = await fs.opendir(path);
			stack.push({ path, handle });
		} catch {
			fold.skip();
		}
	};

	try {
		await openDir(root);

		while (stack.length > 0) {
			throwIfCancelled();

			const frame = stack.at(-1);
			if (!frame) break;

			// Dir.read has a callback overload, so its return type must be pinned here.
			let entry: Dirent | null;
			try {
				entry = await frame.handle.read();
			} catch {
				fold.skip();
				entry = null;
			}

			if (entry === null) {
				stack.pop();
				await closeDir(frame.handle);
				continue;
			}

			const childPath = joinPath(frame.path, entry.name);

			let stats: Stats;
			try {
				stats = await fs.lstat(childPath);
			} catch {
				// Vanished or unreadable between readdir and lstat — a live source
				// does that, and it is not a reason to abandon the walk.
				fold.skip();
				continue;
			}

			nodesScanned += 1;

			if (stats.isDirectory()) {
				if (oneFileSystem && stats.dev !== rootDevice) {
					fold.skip();
					continue;
				}

				// Emitted before descending, so the fold sees strict pre-order.
				fold.push({ path: childPath, type: "dir", mtime: mtimeOf(stats) });
				reportProgress(childPath);
				await openDir(childPath);
				continue;
			}

			fold.push({ path: childPath, type: "file", size: stats.size, mtime: mtimeOf(stats) });
			reportProgress(childPath);
		}
	} finally {
		// Cancellation and unexpected failures must not leak directory handles.
		await Promise.all(stack.map((frame) => closeDir(frame.handle)));
		stack.length = 0;
	}

	onProgress?.({ nodesScanned, currentPath: root });
};
