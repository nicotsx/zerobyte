import {
	DEFAULT_USAGE_LIMITS,
	USAGE_TREE_FORMAT_VERSION,
	type UsageDir,
	type UsageExtension,
	type UsageFile,
	type UsageLimits,
	type UsageNode,
	type UsageTree,
} from "./types.js";

type DirEntry = {
	kind: "dir";
	path: string;
	name: string;
	size: number;
	ownSize: number;
	fileCount: number;
	dirCount: number;
	maxMtime: number;
	/** Immediate children seen, files and directories together. */
	childCount: number;
};

type FileEntry = {
	kind: "file";
	path: string;
	name: string;
	size: number;
	mtime: number;
};

type Entry = DirEntry | FileEntry;

/** A directory currently open on the DFS stack. */
type Frame = Omit<DirEntry, "kind">;

const basename = (path: string) => {
	const index = path.lastIndexOf("/");
	if (index < 0) return path;
	return path.slice(index + 1) || path;
};

export const parentPath = (path: string): string | null => {
	if (path === "/" || path === "") return null;
	const index = path.lastIndexOf("/");
	if (index < 0) return null;
	if (index === 0) return "/";
	return path.slice(0, index);
};

const isAncestorOf = (dir: string, path: string) => path.startsWith(dir === "/" ? "/" : `${dir}/`);

const extensionOf = (name: string) => {
	const index = name.lastIndexOf(".");
	// A leading dot is a hidden file, not an extension.
	if (index <= 0 || index === name.length - 1) return "";
	return name.slice(index + 1).toLowerCase();
};

export type UsageFold = {
	/** Feed one node. Producers must emit depth-first, parents before children. */
	push: (node: UsageNode) => void;
	/** Record an entry the producer could not read. */
	skip: () => void;
	finish: () => UsageTree;
};

export type CreateUsageFoldOptions = {
	/** Paths the walk started from. Falls back to the top-level nodes actually seen. */
	roots?: string[];
	limits?: Partial<UsageLimits>;
};

/**
 * Folds a depth-first stream of nodes into a directory size tree.
 *
 * Producers emit nodes in DFS order, so subtree totals can be rolled up with a
 * stack instead of walking ancestors per file: O(1) amortised per node, and
 * memory bounded by the pruning cap rather than by the number of files.
 */
export const createUsageFold = (options: CreateUsageFoldOptions = {}): UsageFold => {
	const limits: UsageLimits = { ...DEFAULT_USAGE_LIMITS, ...options.limits };

	const stack: Frame[] = [];
	const kept = new Map<string, Entry>();
	const extensions = new Map<string, UsageExtension>();
	const observedRoots: string[] = [];

	const totals = { size: 0, fileCount: 0, dirCount: 0 };
	let skipped = 0;

	// Starts at zero so small trees keep everything; escalates only under pressure.
	let minSize = 0;

	const escalate = () => {
		const entries = [...kept.values()].sort((a, b) => b.size - a.size);
		const cutoff = entries[limits.maxEntries - 1]?.size ?? 0;

		// Drop the ties at the cutoff too, otherwise a run of equal sizes can hold
		// the map above the cap and escalation never converges.
		minSize = cutoff + 1;

		kept.clear();
		for (const entry of entries) {
			if (entry.size < minSize) break;
			kept.set(entry.path, entry);
		}
	};

	const remember = (entry: Entry) => {
		if (entry.size < minSize) return;

		kept.set(entry.path, entry);
		if (kept.size > limits.maxEntries * 2) {
			escalate();
		}
	};

	const trackExtension = (name: string, size: number) => {
		const ext = extensionOf(name);
		const existing = extensions.get(ext);

		if (existing) {
			existing.size += size;
			existing.count += 1;
			return;
		}

		extensions.set(ext, { ext, size, count: 1 });

		if (extensions.size > limits.topExtensions * 10) {
			const survivors = [...extensions.values()].sort((a, b) => b.size - a.size).slice(0, limits.topExtensions);
			extensions.clear();
			for (const survivor of survivors) {
				extensions.set(survivor.ext, survivor);
			}
		}
	};

	/** Fold a finished frame into its parent and decide whether to keep it. */
	const closeFrame = (frame: Frame) => {
		totals.dirCount += 1;

		const parent = stack.at(-1);

		if (parent) {
			parent.size += frame.size;
			parent.fileCount += frame.fileCount;
			parent.dirCount += frame.dirCount + 1;
			parent.maxMtime = Math.max(parent.maxMtime, frame.maxMtime);
		}

		remember({ kind: "dir", ...frame });
	};

	const unwindTo = (path: string) => {
		while (stack.length > 0) {
			const top = stack.at(-1);
			if (top && isAncestorOf(top.path, path)) break;

			stack.pop();
			if (top) closeFrame(top);
		}
	};

	const push = (node: UsageNode) => {
		const path = node.path;
		if (!path) return;

		unwindTo(path);

		const parent = stack.at(-1);
		if (parent) {
			parent.childCount += 1;
		}

		if (node.type === "dir") {
			// A repeated path would double-count; the stack has already unwound past it.
			if (stack.some((frame) => frame.path === path)) return;

			if (!parent) observedRoots.push(path);

			stack.push({
				path,
				name: basename(path),
				size: 0,
				ownSize: 0,
				fileCount: 0,
				dirCount: 0,
				maxMtime: node.mtime ?? 0,
				childCount: 0,
			});
			return;
		}

		const size = node.size ?? 0;
		const mtime = node.mtime ?? 0;

		totals.size += size;
		totals.fileCount += 1;

		if (parent) {
			parent.size += size;
			parent.ownSize += size;
			parent.fileCount += 1;
			parent.maxMtime = Math.max(parent.maxMtime, mtime);
		} else {
			observedRoots.push(path);
		}

		const name = basename(path);
		trackExtension(name, size);
		remember({ kind: "file", path, name, size, mtime });
	};

	const finish = (): UsageTree => {
		while (stack.length > 0) {
			const frame = stack.pop();
			if (frame) closeFrame(frame);
		}

		// Escalation during the walk only fires at twice the cap, to keep it
		// amortised. Trim once more here so the cap the caller asked for is real.
		if (kept.size > limits.maxEntries) {
			escalate();
		}

		const dirs: UsageDir[] = [];
		const files: UsageFile[] = [];
		const keptChildren = new Map<string, { count: number; size: number }>();

		for (const entry of kept.values()) {
			const parent = parentPath(entry.path);
			if (parent === null) continue;

			const bucket = keptChildren.get(parent);
			if (bucket) {
				bucket.count += 1;
				bucket.size += entry.size;
			} else {
				keptChildren.set(parent, { count: 1, size: entry.size });
			}
		}

		for (const entry of kept.values()) {
			if (entry.kind === "file") {
				files.push({ path: entry.path, size: entry.size, mtime: entry.mtime });
				continue;
			}

			const seen = keptChildren.get(entry.path) ?? { count: 0, size: 0 };
			const hiddenCount = Math.max(0, entry.childCount - seen.count);
			const hiddenSize = Math.max(0, entry.size - seen.size);

			const dir: UsageDir = {
				path: entry.path,
				name: entry.name,
				size: entry.size,
				ownSize: entry.ownSize,
				fileCount: entry.fileCount,
				dirCount: entry.dirCount,
				maxMtime: entry.maxMtime,
			};

			if (hiddenCount > 0 || hiddenSize > 0) {
				dir.truncatedChildren = { count: hiddenCount, size: hiddenSize };
			}

			dirs.push(dir);
		}

		dirs.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
		files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

		const largestFiles = [...files].sort((a, b) => b.size - a.size).slice(0, limits.topFiles);
		const byExtension = [...extensions.values()].sort((a, b) => b.size - a.size).slice(0, limits.topExtensions);

		return {
			formatVersion: USAGE_TREE_FORMAT_VERSION,
			roots: options.roots?.length ? options.roots : dedupe(observedRoots),
			totals,
			dirs,
			files,
			largestFiles,
			byExtension,
			limits,
			appliedMinSize: minSize,
			skipped,
		};
	};

	return {
		push,
		skip: () => {
			skipped += 1;
		},
		finish,
	};
};

const dedupe = (values: string[]) => [...new Set(values)];
