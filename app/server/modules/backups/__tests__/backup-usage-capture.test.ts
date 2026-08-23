import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "~/server/db/db";
import { backupSchedulesTable, snapshotUsageScansTable, volumesTable } from "~/server/db/schema";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { createTestRepository } from "~/test/helpers/repository";
import { createTestVolume } from "~/test/helpers/volume";
import { TEST_ORG_ID } from "~/test/helpers/organization";
import { captureSnapshotUsage } from "../helpers/backup-usage-capture";
import type { BackupContext } from "../helpers/backup-lifecycle";
import { loadUsageTree, pruneUsageTrees, saveUsageTree } from "../../repositories/helpers/snapshot-usage-store";
import * as walkModule from "@zerobyte/core/usage/node";
import { createUsageFold } from "@zerobyte/core/usage";
import type { ShortId } from "~/server/utils/branded";

let sourceDir: string;

const buildContext = async (
	overrides: {
		schedule?: Partial<typeof backupSchedulesTable.$inferInsert>;
		volume?: Partial<typeof volumesTable.$inferInsert>;
	} = {},
): Promise<BackupContext> => {
	const repository = await createTestRepository();
	const volume = await createTestVolume({
		config: { backend: "directory", path: sourceDir },
		...overrides.volume,
	});
	const schedule = await createTestBackupSchedule({
		repositoryId: repository?.id,
		volumeId: volume?.id,
		...overrides.schedule,
	});

	if (!repository || !volume || !schedule) throw new Error("Failed to build test context");

	return { schedule, volume, repository, organizationId: TEST_ORG_ID };
};

const writeSource = async (relativePath: string, size: number) => {
	const target = path.join(sourceDir, relativePath);
	await fs.mkdir(path.dirname(target), { recursive: true });
	await fs.writeFile(target, "x".repeat(size));
};

beforeEach(async () => {
	sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-capture-"));
});

afterEach(async () => {
	vi.restoreAllMocks();
	await fs.rm(sourceDir, { recursive: true, force: true });
	await db.delete(snapshotUsageScansTable);
});

describe("captureSnapshotUsage", () => {
	test("stores a usage tree for the snapshot the backup produced", async () => {
		await writeSource("media/big.iso", 500);
		await writeSource("docs/small.txt", 20);

		const ctx = await buildContext();
		await captureSnapshotUsage({ ctx, snapshotId: "abc1234" });

		const stored = loadUsageTree({
			repositoryId: ctx.repository.id,
			organizationId: TEST_ORG_ID,
			snapshotId: "abc1234",
		});

		expect(stored?.meta.source).toBe("backup");
		expect(stored?.meta.totalSize).toBe(520);
		expect(stored?.meta.fileCount).toBe(2);

		const children = stored?.children.get(sourceDir) ?? [];
		expect(children.map((child) => child.name)).toEqual(["media", "docs"]);
		expect(children[0]?.size).toBe(500);
	});

	test("does not throw when the source cannot be walked", async () => {
		const ctx = await buildContext({ volume: { config: { backend: "directory", path: "/nope/missing" } } });

		await expect(captureSnapshotUsage({ ctx, snapshotId: "abc1234" })).resolves.toBeUndefined();

		const rows = await db.select().from(snapshotUsageScansTable);
		expect(rows).toHaveLength(0);
	});

	test("is a no-op without a snapshot id", async () => {
		const walkSpy = vi.spyOn(walkModule, "walkSource");
		const ctx = await buildContext();

		await captureSnapshotUsage({ ctx, snapshotId: null });

		expect(walkSpy).not.toHaveBeenCalled();
	});

	test("skips volumes that live on a remote agent", async () => {
		await writeSource("a.txt", 10);
		const walkSpy = vi.spyOn(walkModule, "walkSource");
		const ctx = await buildContext({ volume: { agentId: "remote-agent-1" } });

		await captureSnapshotUsage({ ctx, snapshotId: "abc1234" });

		expect(walkSpy).not.toHaveBeenCalled();
	});

	test("passes the schedule's one-file-system setting through to the walk", async () => {
		await writeSource("a.txt", 10);
		const walkSpy = vi.spyOn(walkModule, "walkSource");
		const ctx = await buildContext({ schedule: { oneFileSystem: true } });

		await captureSnapshotUsage({ ctx, snapshotId: "abc1234" });

		expect(walkSpy).toHaveBeenCalledWith(expect.objectContaining({ oneFileSystem: true, root: sourceDir }));
	});

	test("stores the tree under restic's short id, not the full backup summary id", async () => {
		await writeSource("a.txt", 10);
		const ctx = await buildContext();
		const fullSnapshotId = "aacec5b97acf52374e56f10e16e7b324afd1056388b1a3e67c904286305cc47";

		await captureSnapshotUsage({ ctx, snapshotId: fullSnapshotId });

		const stored = loadUsageTree({
			repositoryId: ctx.repository.id,
			organizationId: TEST_ORG_ID,
			snapshotId: fullSnapshotId.slice(0, 8),
		});

		expect(stored?.meta.totalSize).toBe(10);

		const rows = await db.select().from(snapshotUsageScansTable);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.snapshotId).toBe(fullSnapshotId.slice(0, 8));
	});

	test("replaces an existing tree for the same snapshot rather than duplicating it", async () => {
		await writeSource("a.txt", 10);
		const ctx = await buildContext();

		await captureSnapshotUsage({ ctx, snapshotId: "abc1234" });
		await writeSource("b.txt", 90);
		await captureSnapshotUsage({ ctx, snapshotId: "abc1234" });

		const rows = await db
			.select()
			.from(snapshotUsageScansTable)
			.where(eq(snapshotUsageScansTable.snapshotId, "abc1234"));

		expect(rows).toHaveLength(1);
		expect(rows[0]?.totalSize).toBe(100);
	});
});

describe("pruneUsageTrees", () => {
	const storeTree = async (params: { repositoryId: string; snapshotId: string; scheduleShortId: ShortId }) => {
		const fold = createUsageFold({ roots: ["/data"] });
		fold.push({ path: "/data", type: "dir" });
		fold.push({ path: "/data/a.bin", type: "file", size: 1 });

		saveUsageTree({
			repositoryId: params.repositoryId,
			organizationId: TEST_ORG_ID,
			snapshotId: params.snapshotId,
			scheduleShortId: params.scheduleShortId,
			source: "backup",
			durationMs: 1,
			tree: fold.finish(),
		});

		// scannedAt defaults to now; force distinct values so ordering is stable.
		await db
			.update(snapshotUsageScansTable)
			.set({ scannedAt: Number(params.snapshotId.replace(/\D/g, "")) })
			.where(
				and(
					eq(snapshotUsageScansTable.repositoryId, params.repositoryId),
					eq(snapshotUsageScansTable.snapshotId, params.snapshotId),
				),
			);
	};

	test("keeps only the newest trees per schedule", async () => {
		const ctx = await buildContext();
		const scheduleShortId = ctx.schedule.shortId;

		for (let index = 1; index <= 6; index++) {
			await storeTree({ repositoryId: ctx.repository.id, snapshotId: `snap${index}`, scheduleShortId });
		}

		pruneUsageTrees({ organizationId: TEST_ORG_ID, scheduleShortId, keep: 3 });

		const remaining = await db
			.select({ snapshotId: snapshotUsageScansTable.snapshotId })
			.from(snapshotUsageScansTable)
			.where(eq(snapshotUsageScansTable.scheduleShortId, scheduleShortId));

		expect(remaining.map((row) => row.snapshotId).sort()).toEqual(["snap4", "snap5", "snap6"]);
	});

	test("never evicts trees that were paid for with repository reads", async () => {
		const ctx = await buildContext();
		const scheduleShortId = ctx.schedule.shortId;
		const fold = createUsageFold({ roots: ["/data"] });
		fold.push({ path: "/data", type: "dir" });

		saveUsageTree({
			repositoryId: ctx.repository.id,
			organizationId: TEST_ORG_ID,
			snapshotId: "scanned",
			scheduleShortId,
			source: "scan",
			durationMs: 1,
			tree: fold.finish(),
		});

		for (let index = 1; index <= 4; index++) {
			await storeTree({ repositoryId: ctx.repository.id, snapshotId: `snap${index}`, scheduleShortId });
		}

		pruneUsageTrees({ organizationId: TEST_ORG_ID, scheduleShortId, keep: 1 });

		const remaining = await db
			.select({ snapshotId: snapshotUsageScansTable.snapshotId })
			.from(snapshotUsageScansTable)
			.where(eq(snapshotUsageScansTable.scheduleShortId, scheduleShortId));

		expect(remaining.map((row) => row.snapshotId)).toContain("scanned");
	});
});
