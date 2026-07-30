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
import { Effect } from "effect";
import { taskStore } from "~/server/modules/tasks/tasks.store";
import { requestTaskCancel } from "~/server/modules/tasks/tasks.lifecycle";
import { cache, cacheKeys } from "~/server/utils/cache";

const setup = () => {
	vi.spyOn(context, "getOrganizationId").mockReturnValue(TEST_ORG_ID);
	vi.spyOn(spawnModule, "safeSpawn").mockImplementation(() =>
		Promise.resolve({ exitCode: 0, summary: "", error: "" }),
	);

	return {
		mockSnapshots: (sourceSnapshots: unknown[], mirrorSnapshots: unknown[]) => {
			let callCount = 0;
			vi.spyOn(resticModule.restic, "snapshots").mockImplementation(() => {
				callCount++;
				if (callCount === 1) return Effect.succeed(sourceSnapshots as never);
				return Effect.succeed(mirrorSnapshots as never);
			});
		},
		mockCopy: () => {
			const copyMock = vi
				.spyOn(resticModule.restic, "copy")
				.mockImplementation(() => Effect.succeed({ success: true }));
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
	test("should start a mirror sync task", async () => {
		const { mockCopy } = setup();
		mockCopy();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});
		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);

		const result = await backupsService.startMirrorSync(schedule.shortId, mirrorRepository.shortId as ShortId, [
			"snap1",
			"snap2",
		]);

		expect(result).toEqual({ taskId: expect.any(String), status: "started" });
		await waitForExpect(() => {
			const task = taskStore.findById({ organizationId: TEST_ORG_ID, taskId: result.taskId });
			expect(task).toMatchObject({
				kind: "mirrorSync",
				status: "succeeded",
				resourceType: "backup_schedule",
				resourceId: schedule.shortId,
				operationKey: mirrorRepository.shortId,
				input: {
					kind: "mirrorSync",
					scheduleId: schedule.id,
					scheduleShortId: schedule.shortId,
					mirrorRepositoryId: mirrorRepository.shortId,
					snapshotIds: ["snap1", "snap2"],
				},
				result: { kind: "mirrorSync" },
			});
		});
	});

	test("should pass custom restic params to manual mirror sync", async () => {
		const { mockCopy } = setup();
		const copyMock = mockCopy();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			customResticParams: ["--pack-size 64", "--ignore-inode"],
		});
		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);

		const result = await backupsService.startMirrorSync(schedule.shortId, mirrorRepository.shortId as ShortId, [
			"snap1",
		]);

		expect(result.status).toBe("started");
		await waitForExpect(() => {
			expect(copyMock).toHaveBeenCalledWith(
				repository.config,
				mirrorRepository.config,
				expect.objectContaining({
					tag: schedule.shortId,
					organizationId: TEST_ORG_ID,
					snapshotIds: ["snap1"],
					customResticParams: ["--pack-size 64", "--ignore-inode"],
				}),
			);
		});
	});

	test("should persist the latest restic copy message on the mirror task", async () => {
		setup();
		const message = "[1:02] 60.71%  34 / 56 packs copied";
		vi.spyOn(resticModule.restic, "copy").mockImplementation((_source, _destination, options) =>
			Effect.sync(() => {
				options.onMessage?.(message);
				return { success: true };
			}),
		);
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});
		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);

		const result = await backupsService.startMirrorSync(schedule.shortId, mirrorRepository.shortId as ShortId, [
			"snap1",
		]);

		await waitForExpect(() => {
			const task = taskStore.findById({ organizationId: TEST_ORG_ID, taskId: result.taskId });
			expect(task).toMatchObject({
				status: "succeeded",
				progress: {
					kind: "mirrorSync",
					phase: "copying",
					message,
				},
			});
		});
	});

	test("should derive the mirror summary from the latest finished task", async () => {
		const { mockCopy } = setup();
		mockCopy();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});
		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);
		const previousTask = taskStore.create({
			organizationId: TEST_ORG_ID,
			resourceType: "backup_schedule",
			resourceId: schedule.shortId,
			operationKey: mirrorRepository.shortId,
			input: {
				kind: "mirrorSync",
				scheduleId: schedule.id,
				scheduleShortId: schedule.shortId,
				mirrorRepositoryId: mirrorRepository.shortId,
			},
		});
		taskStore.fail(previousTask.id, "Previous copy failed");

		const mirrors = await backupsService.getMirrors(schedule.shortId);
		expect(mirrors[0]?.lastSyncTask).toMatchObject({
			id: previousTask.id,
			status: "failed",
			error: "Previous copy failed",
		});

		const result = await backupsService.startMirrorSync(schedule.shortId, mirrorRepository.shortId as ShortId, [
			"snap1",
		]);

		expect(result.status).toBe("started");
		await waitForExpect(() => {
			const task = taskStore.findById({ organizationId: TEST_ORG_ID, taskId: result.taskId });
			expect(task?.status).toBe("succeeded");
		});
	});

	test("should reject a concurrent task and finalize the mirror summary when cancellation is requested", async () => {
		const { mockCopy } = setup();
		const copyMock = mockCopy();
		const clearRepositoryCache = vi.spyOn(cache, "delByPrefix");
		const copyStarted = new Promise<void>((resolve) => {
			copyMock.mockImplementation((_source, _destination, options) =>
				Effect.promise(
					() =>
						new Promise((_, reject) => {
							options.signal?.addEventListener(
								"abort",
								() => reject(new DOMException("Mirror sync was cancelled", "AbortError")),
								{ once: true },
							);
							resolve();
						}),
				),
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

		const firstSync = await backupsService.startMirrorSync(schedule.shortId, mirrorRepository.shortId as ShortId, [
			"snap1",
		]);

		await copyStarted;

		await waitForExpect(() => {
			const task = taskStore.findById({
				organizationId: TEST_ORG_ID,
				taskId: firstSync.taskId,
			});
			expect(task?.status).toBe("running");
		});

		await expect(
			backupsService.startMirrorSync(schedule.shortId, mirrorRepository.shortId as ShortId, ["snap1"]),
		).rejects.toThrow("Mirror is already syncing");

		expect(requestTaskCancel(firstSync.taskId)).toBe(true);

		await waitForExpect(async () => {
			const task = taskStore.findById({
				organizationId: TEST_ORG_ID,
				taskId: firstSync.taskId,
			});
			const mirrors = await backupsService.getMirrors(schedule.shortId);
			expect(task?.status).toBe("cancelled");
			expect(clearRepositoryCache).toHaveBeenCalledWith(cacheKeys.repository.all(mirrorRepository.id));
			expect(mirrors[0]?.lastSyncTask).toMatchObject({
				id: firstSync.taskId,
				status: "cancelled",
				error: "Mirror sync was cancelled",
			});
		});
	});

	test("should cancel while applying mirror retention", async () => {
		const { mockCopy } = setup();
		mockCopy();
		const forgetStarted = new Promise<void>((resolve) => {
			vi.spyOn(resticModule.restic, "forget").mockImplementation((_config, _policy, options) =>
				Effect.promise(
					() =>
						new Promise((_, reject) => {
							options.signal?.addEventListener(
								"abort",
								() => reject(new DOMException("Mirror sync was cancelled", "AbortError")),
								{ once: true },
							);
							resolve();
						}),
				),
			);
		});
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			retentionPolicy: { keepHourly: 1 },
		});
		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);

		const result = await backupsService.startMirrorSync(schedule.shortId, mirrorRepository.shortId as ShortId, [
			"snap1",
		]);

		await forgetStarted;
		await waitForExpect(() => {
			const task = taskStore.findById({ organizationId: TEST_ORG_ID, taskId: result.taskId });
			expect(task?.progress).toEqual({
				kind: "mirrorSync",
				phase: "retention",
				message: null,
			});
		});
		expect(requestTaskCancel(result.taskId)).toBe(true);

		await waitForExpect(() => {
			const task = taskStore.findById({ organizationId: TEST_ORG_ID, taskId: result.taskId });
			expect(task?.status).toBe("cancelled");
		});
	});

	test("keeps the mirror sync successful when retention maintenance fails", async () => {
		const { mockCopy } = setup();
		mockCopy();
		vi.spyOn(resticModule.restic, "forget").mockImplementation(() =>
			Effect.sync(() => {
				throw new Error("Retention maintenance failed");
			}),
		);
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			retentionPolicy: { keepHourly: 1 },
		});
		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);

		const result = await backupsService.startMirrorSync(schedule.shortId, mirrorRepository.shortId as ShortId, [
			"snap1",
		]);

		await waitForExpect(async () => {
			const task = taskStore.findById({ organizationId: TEST_ORG_ID, taskId: result.taskId });
			const mirrors = await backupsService.getMirrors(schedule.shortId);
			expect(task).toMatchObject({ status: "succeeded", error: null });
			expect(mirrors[0]?.lastSyncTask).toMatchObject({ status: "succeeded", error: null });
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
			backupsService.startMirrorSync(schedule.shortId, unrelatedRepository.shortId as ShortId, ["snap1"]),
		).rejects.toThrow("Mirror not found for this schedule");
	});
});
