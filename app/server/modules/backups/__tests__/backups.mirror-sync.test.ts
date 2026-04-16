import { afterEach, describe, expect, test, vi } from "vitest";
import waitForExpect from "wait-for-expect";
import { backupsService } from "../backups.service";
import { createTestVolume } from "~/test/helpers/volume";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { createTestRepository } from "~/test/helpers/repository";
import { createTestBackupScheduleMirror } from "~/test/helpers/backup-mirror";
import { TEST_ORG_ID } from "~/test/helpers/organization";
import * as context from "~/server/core/request-context";
import * as resticModule from "~/server/core/restic";
import * as spawnModule from "@zerobyte/core/node";
import type { ShortId } from "~/server/utils/branded";

const setup = () => {
	vi.spyOn(context, "getOrganizationId").mockReturnValue(TEST_ORG_ID);
	vi.spyOn(spawnModule, "safeSpawn").mockImplementation(() => Promise.resolve({ exitCode: 0, summary: "", error: "" }));

	return {
		mockSnapshots: (sourceSnapshots: unknown[], mirrorSnapshots: unknown[]) => {
			let callCount = 0;
			vi.spyOn(resticModule.restic, "snapshots").mockImplementation(() => {
				callCount++;
				if (callCount === 1) return Promise.resolve(sourceSnapshots as never);
				return Promise.resolve(mirrorSnapshots as never);
			});
		},
		mockCopy: () => {
			const copyMock = vi
				.spyOn(resticModule.restic, "copy")
				.mockImplementation(() => Promise.resolve({ success: true, output: "" }));
			return copyMock;
		},
	};
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("getMirrorSyncStatus", () => {
	test("should return missing snapshots based on time comparison", async () => {
		const { mockSnapshots } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});
		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);

		mockSnapshots(
			[
				{
					id: "aaa",
					short_id: "aaa",
					time: "2025-01-01T10:00:00Z",
					paths: ["/data"],
					summary: { total_bytes_processed: 100 },
				},
				{
					id: "bbb",
					short_id: "bbb",
					time: "2025-01-02T10:00:00Z",
					paths: ["/data"],
					summary: { total_bytes_processed: 200 },
				},
				{
					id: "ccc",
					short_id: "ccc",
					time: "2025-01-03T10:00:00Z",
					paths: ["/data"],
					summary: { total_bytes_processed: 300 },
				},
			],
			[
				{
					id: "xxx",
					short_id: "xxx",
					time: "2025-01-01T10:00:00Z",
					paths: ["/data"],
					summary: { total_bytes_processed: 100 },
				},
			],
		);

		const status = await backupsService.getMirrorSyncStatus(schedule.shortId, mirrorRepository.shortId as ShortId);

		expect(status.sourceCount).toBe(3);
		expect(status.mirrorCount).toBe(1);
		expect(status.missingSnapshots).toHaveLength(2);
		expect(status.missingSnapshots.map((s) => s.short_id)).toEqual(["bbb", "ccc"]);
	});

	test("should return empty missing list when all snapshots are synced", async () => {
		const { mockSnapshots } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});
		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);

		mockSnapshots(
			[
				{
					id: "aaa",
					short_id: "aaa",
					time: "2025-01-01T10:00:00Z",
					paths: ["/data"],
					summary: { total_bytes_processed: 100 },
				},
			],
			[
				{
					id: "xxx",
					short_id: "xxx",
					time: "2025-01-01T10:00:00Z",
					paths: ["/data"],
					summary: { total_bytes_processed: 100 },
				},
			],
		);

		const status = await backupsService.getMirrorSyncStatus(schedule.shortId, mirrorRepository.shortId as ShortId);

		expect(status.sourceCount).toBe(1);
		expect(status.mirrorCount).toBe(1);
		expect(status.missingSnapshots).toHaveLength(0);
	});

	test("should throw if mirror is not configured for the schedule", async () => {
		setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const unrelatedRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		await expect(
			backupsService.getMirrorSyncStatus(schedule.shortId, unrelatedRepository.shortId as ShortId),
		).rejects.toThrow("Mirror not found for this schedule");
	});
});

describe("syncMirror", () => {
	test("should trigger sync and return success", async () => {
		setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});
		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);

		const result = await backupsService.syncMirror(schedule.shortId, mirrorRepository.shortId as ShortId, [
			"snap1",
			"snap2",
		]);

		expect(result.success).toBe(true);
	});

	test("should reject if mirror is already syncing", async () => {
		setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});
		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id, {
			lastCopyStatus: "in_progress",
		});

		await expect(
			backupsService.syncMirror(schedule.shortId, mirrorRepository.shortId as ShortId, ["snap1"]),
		).rejects.toThrow("Mirror is already syncing");
	});

	test("should reject concurrent sync requests once a sync has started", async () => {
		const { mockCopy } = setup();
		const copyMock = mockCopy();
		let releaseCopy: (() => void) | undefined;
		const copyStarted = new Promise<void>((resolve) => {
			copyMock.mockImplementation(
				() =>
					new Promise((copyResolve) => {
						releaseCopy = () => copyResolve({ success: true, output: "" });
						resolve();
					}),
			);
		});

		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});
		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);

		await expect(
			backupsService.syncMirror(schedule.shortId, mirrorRepository.shortId as ShortId, ["snap1"]),
		).resolves.toEqual({ success: true });

		await copyStarted;

		await waitForExpect(async () => {
			const mirrors = await backupsService.getMirrors(schedule.shortId);
			expect(mirrors[0]?.lastCopyStatus).toBe("in_progress");
		});

		await expect(
			backupsService.syncMirror(schedule.shortId, mirrorRepository.shortId as ShortId, ["snap1"]),
		).rejects.toThrow("Mirror is already syncing");

		releaseCopy?.();

		await waitForExpect(async () => {
			const mirrors = await backupsService.getMirrors(schedule.shortId);
			expect(mirrors[0]?.lastCopyStatus).toBe("success");
		});
	});

	test("should throw if mirror is not configured for the schedule", async () => {
		setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const unrelatedRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		await expect(
			backupsService.syncMirror(schedule.shortId, unrelatedRepository.shortId as ShortId, ["snap1"]),
		).rejects.toThrow("Mirror not found for this schedule");
	});
});
