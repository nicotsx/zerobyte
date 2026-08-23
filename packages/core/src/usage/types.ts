export const USAGE_TREE_FORMAT_VERSION = 1;

/**
 * A directory kept in the persisted tree.
 *
 * Sizes are *apparent* sizes — the original size of the files on disk, before
 * restic deduplicates and compresses them. This matches what `du`/`ncdu` report
 * and is the right number for deciding whether something is worth backing up.
 * It is deliberately not the space the repository actually consumes.
 */
export type UsageDir = {
	/** Absolute path, without a trailing slash (except the root "/"). */
	path: string;
	name: string;
	/** Total apparent size of every file in this subtree. */
	size: number;
	/** Bytes held by files sitting directly in this directory. */
	ownSize: number;
	/** Files anywhere in this subtree. */
	fileCount: number;
	/** Directories anywhere in this subtree, excluding this one. */
	dirCount: number;
	/** Newest mtime anywhere in this subtree, epoch ms. 0 when unknown. */
	maxMtime: number;
	/** Children dropped by pruning, so a drill-down can still account for them. */
	truncatedChildren?: { count: number; size: number };
};

export type UsageFile = {
	path: string;
	size: number;
	/** Epoch ms, 0 when unknown. */
	mtime: number;
};

export type UsageExtension = {
	/** Lowercased, without the leading dot. Empty string means "no extension". */
	ext: string;
	size: number;
	count: number;
};

export type UsageTree = {
	formatVersion: typeof USAGE_TREE_FORMAT_VERSION;
	roots: string[];
	totals: { size: number; fileCount: number; dirCount: number };
	/** Pruned, sorted by path so a directory's children can be found by prefix. */
	dirs: UsageDir[];
	/**
	 * Files that survived pruning, sorted by path. The explorer needs these so a
	 * directory holding one enormous file doesn't drill down into an empty list.
	 */
	files: UsageFile[];
	/** The largest kept files across the whole tree, size descending. */
	largestFiles: UsageFile[];
	byExtension: UsageExtension[];
	limits: UsageLimits;
	/** The size threshold pruning actually settled on, after any escalation. */
	appliedMinSize: number;
	/** Entries the producer could not read (permissions, races). */
	skipped: number;
};

export type UsageLimits = {
	/**
	 * Hard cap on kept entries, directories and files together. Pruning starts at
	 * a zero threshold — so a small tree keeps everything — and raises the
	 * threshold only under pressure. During the walk the threshold escalates at
	 * twice this number to keep the work amortised; the final tree is trimmed
	 * back to the cap itself.
	 */
	maxEntries: number;
	topFiles: number;
	topExtensions: number;
};

export const DEFAULT_USAGE_LIMITS: UsageLimits = {
	maxEntries: 50_000,
	topFiles: 1000,
	topExtensions: 100,
};

/**
 * A node handed to the fold. Producers (a `restic ls` stream, a filesystem walk)
 * must emit these in depth-first order, parents before their children.
 */
export type UsageNode = {
	path: string;
	type: "file" | "dir";
	size?: number;
	/** Epoch ms. */
	mtime?: number;
};
