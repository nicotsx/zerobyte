import { gunzipSync, gzipSync } from "node:zlib";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { USAGE_TREE_FORMAT_VERSION, type UsageTree } from "@zerobyte/core/usage";
import { logger } from "@zerobyte/core/node";
import { db } from "~/server/db/db";
import { snapshotUsageScansTable } from "~/server/db/schema";
import type { ShortId } from "~/server/utils/branded";
import type {
	SnapshotUsageDirectory,
	SnapshotUsageEntry,
	SnapshotUsageMeta,
	SnapshotUsageSource,
} from "~/schemas/snapshot-usage";
import { parentPath } from "@zerobyte/core/usage";

/**
 * How many trees to keep per schedule. Every backup writes one, so without a
 * ceiling a nightly job would add roughly a gigabyte a year to the database.
 */
export const DEFAULT_USAGE_TREE_RETENTION = 10;

/** Inflating and indexing a multi-megabyte tree per request would be wasteful. */
const CACHE_SIZE = 2;

type IndexedTree = {
	key: string;
	scannedAt: number;
	meta: SnapshotUsageMeta;
	/** Children of each directory, largest first. */
	children: Map<string, SnapshotUsageEntry[]>;
	/** Full stats per directory, including children pruning dropped. */
	directoryDetails: Map<string, SnapshotUsageDirectory>;
};

const cache: IndexedTree[] = [];

const cacheKeyOf = (repositoryId: string, snapshotId: string) => `${repositoryId}:${snapshotId}`;

const readCache = (key: string, scannedAt: number) => {
	const index = cache.findIndex((entry) => entry.key === key && entry.scannedAt === scannedAt);
	if (index < 0) return undefined;

	const [entry] = cache.splice(index, 1);
	if (entry) cache.unshift(entry);
	return entry;
};

const writeCache = (entry: IndexedTree) => {
	cache.unshift(entry);
	cache.length = Math.min(cache.length, CACHE_SIZE);
};

export const clearSnapshotUsageCache = () => {
	cache.length = 0;
};

const share = (value: number, total: number) => (total > 0 ? value / total : 0);

const buildIndex = (
	key: string,
	scannedAt: number,
	source: SnapshotUsageSource,
	durationMs: number,
	tree: UsageTree,
) => {
	const meta: SnapshotUsageMeta = {
		source,
		scannedAt,
		durationMs,
		totalSize: tree.totals.size,
		fileCount: tree.totals.fileCount,
		dirCount: tree.totals.dirCount,
		roots: tree.roots,
		skipped: tree.skipped,
		appliedMinSize: tree.appliedMinSize,
	};

	const directories = new Map<string, SnapshotUsageEntry>();
	const directoryDetails = new Map<string, SnapshotUsageDirectory>();
	const bySize = new Map<string, number>();

	for (const dir of tree.dirs) {
		bySize.set(dir.path, dir.size);
		directoryDetails.set(dir.path, {
			path: dir.path,
			name: dir.name,
			size: dir.size,
			ownSize: dir.ownSize,
			fileCount: dir.fileCount,
			dirCount: dir.dirCount,
			maxMtime: dir.maxMtime,
			truncatedChildren: dir.truncatedChildren,
		});
		directories.set(dir.path, {
			path: dir.path,
			name: dir.name,
			type: "dir",
			size: dir.size,
			shareOfParent: 0,
			shareOfTotal: share(dir.size, tree.totals.size),
			fileCount: dir.fileCount,
			dirCount: dir.dirCount,
			maxMtime: dir.maxMtime,
		});
	}

	const children = new Map<string, SnapshotUsageEntry[]>();

	const addChild = (entry: SnapshotUsageEntry) => {
		const parent = parentPath(entry.path);
		if (parent === null) return;

		const bucket = children.get(parent);
		if (bucket) {
			bucket.push(entry);
		} else {
			children.set(parent, [entry]);
		}
	};

	for (const entry of directories.values()) {
		addChild(entry);
	}

	const files: SnapshotUsageEntry[] = tree.files.map((file) => ({
		path: file.path,
		name: file.path.slice(file.path.lastIndexOf("/") + 1),
		type: "file" as const,
		size: file.size,
		shareOfParent: 0,
		shareOfTotal: share(file.size, tree.totals.size),
		maxMtime: file.mtime,
	}));

	for (const file of files) {
		addChild(file);
	}

	for (const [parent, bucket] of children) {
		const parentSize = bySize.get(parent) ?? bucket.reduce((sum, entry) => sum + entry.size, 0);
		for (const entry of bucket) {
			entry.shareOfParent = share(entry.size, parentSize);
		}
		bucket.sort((a, b) => b.size - a.size);
	}

	return {
		key,
		scannedAt,
		meta,
		children,
		directoryDetails,
	} satisfies IndexedTree;
};

export type SaveUsageTreeParams = {
	repositoryId: string;
	organizationId: string;
	snapshotId: string;
	scheduleShortId?: ShortId | null;
	source: SnapshotUsageSource;
	durationMs: number;
	tree: UsageTree;
};

export const saveUsageTree = (params: SaveUsageTreeParams) => {
	const compressed = gzipSync(Buffer.from(JSON.stringify(params.tree), "utf-8"));
	const now = Date.now();

	db.insert(snapshotUsageScansTable)
		.values({
			repositoryId: params.repositoryId,
			organizationId: params.organizationId,
			snapshotId: params.snapshotId,
			scheduleShortId: params.scheduleShortId ?? null,
			formatVersion: USAGE_TREE_FORMAT_VERSION,
			source: params.source,
			totalSize: params.tree.totals.size,
			fileCount: params.tree.totals.fileCount,
			dirCount: params.tree.totals.dirCount,
			scannedAt: now,
			durationMs: params.durationMs,
			tree: compressed,
		})
		.onConflictDoUpdate({
			target: [snapshotUsageScansTable.repositoryId, snapshotUsageScansTable.snapshotId],
			set: {
				scheduleShortId: params.scheduleShortId ?? null,
				formatVersion: USAGE_TREE_FORMAT_VERSION,
				source: params.source,
				totalSize: params.tree.totals.size,
				fileCount: params.tree.totals.fileCount,
				dirCount: params.tree.totals.dirCount,
				scannedAt: now,
				durationMs: params.durationMs,
				tree: compressed,
			},
		})
		.run();

	clearSnapshotUsageCache();
};

/**
 * Keeps the newest `keep` trees for a schedule and drops the rest.
 *
 * Scan-sourced trees are exempt: those were paid for with reads against the
 * repository, sometimes a metered one, so they are never evicted automatically.
 */
export const pruneUsageTrees = (params: { organizationId: string; scheduleShortId: ShortId; keep?: number }) => {
	const keep = params.keep ?? DEFAULT_USAGE_TREE_RETENTION;

	const survivors = db
		.select({ id: snapshotUsageScansTable.id })
		.from(snapshotUsageScansTable)
		.where(
			and(
				eq(snapshotUsageScansTable.organizationId, params.organizationId),
				eq(snapshotUsageScansTable.scheduleShortId, params.scheduleShortId),
				eq(snapshotUsageScansTable.source, "backup"),
			),
		)
		.orderBy(desc(snapshotUsageScansTable.scannedAt))
		.limit(keep)
		.all()
		.map((row) => row.id);

	const deleted = db
		.delete(snapshotUsageScansTable)
		.where(
			and(
				eq(snapshotUsageScansTable.organizationId, params.organizationId),
				eq(snapshotUsageScansTable.scheduleShortId, params.scheduleShortId),
				eq(snapshotUsageScansTable.source, "backup"),
				survivors.length > 0 ? notInArray(snapshotUsageScansTable.id, survivors) : undefined,
			),
		)
		.returning({ id: snapshotUsageScansTable.id })
		.all();

	if (deleted.length > 0) {
		logger.debug(`Pruned ${deleted.length} usage tree(s) for schedule ${params.scheduleShortId}`);
		clearSnapshotUsageCache();
	}

	return deleted.length;
};

export const deleteUsageTrees = (repositoryId: string, snapshotIds: string[]) => {
	if (snapshotIds.length === 0) return 0;

	const deleted = db
		.delete(snapshotUsageScansTable)
		.where(
			and(
				eq(snapshotUsageScansTable.repositoryId, repositoryId),
				inArray(snapshotUsageScansTable.snapshotId, snapshotIds),
			),
		)
		.returning({ id: snapshotUsageScansTable.id })
		.all();

	if (deleted.length > 0) clearSnapshotUsageCache();

	return deleted.length;
};

export const findUsageTreeRow = (params: { repositoryId: string; organizationId: string; snapshotId: string }) =>
	db
		.select()
		.from(snapshotUsageScansTable)
		.where(
			and(
				eq(snapshotUsageScansTable.repositoryId, params.repositoryId),
				eq(snapshotUsageScansTable.organizationId, params.organizationId),
				eq(snapshotUsageScansTable.snapshotId, params.snapshotId),
			),
		)
		.get();

/**
 * Loads a snapshot's tree, inflated and indexed for drill-down.
 *
 * Returns undefined when there is nothing stored, or when what is stored was
 * written by an older format version — a stale tree is worse than none, because
 * it would show numbers the current code cannot interpret.
 */
export const loadUsageTree = (params: {
	repositoryId: string;
	organizationId: string;
	snapshotId: string;
}): IndexedTree | undefined => {
	const row = findUsageTreeRow(params);
	if (!row) return undefined;

	if (row.formatVersion !== USAGE_TREE_FORMAT_VERSION) {
		logger.debug(
			`Ignoring usage tree for snapshot ${params.snapshotId}: format ${row.formatVersion}, expected ${USAGE_TREE_FORMAT_VERSION}`,
		);
		return undefined;
	}

	const key = cacheKeyOf(params.repositoryId, params.snapshotId);
	const cached = readCache(key, row.scannedAt);
	if (cached) return cached;

	let tree: UsageTree;
	try {
		tree = JSON.parse(gunzipSync(Buffer.from(row.tree)).toString("utf-8")) as UsageTree;
	} catch (error) {
		logger.error(`Failed to read usage tree for snapshot ${params.snapshotId}: ${String(error)}`);
		return undefined;
	}

	const indexed = buildIndex(key, row.scannedAt, row.source, row.durationMs, tree);
	writeCache(indexed);

	return indexed;
};

export type { IndexedTree };
