import { afterEach, describe, expect, test, vi } from "vitest";
import waitForExpect from "wait-for-expect";
import { eq } from "drizzle-orm";
import { backupsService } from "../backups.service";
import { createTestVolume } from "~/test/helpers/volume";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { createTestRepository } from "~/test/helpers/repository";
import { createTestBackupScheduleMirror } from "~/test/helpers/backup-mirror";
import { createTestOrganization, TEST_ORG_ID } from "~/test/helpers/organization";
import * as context from "~/server/core/request-context";
import * as resticModule from "~/server/core/restic";
import * as spawnModule from "@zerobyte/core/node";
import type { ShortId } from "~/server/utils/branded";
import { Effect } from "effect";
import { taskStore } from "~/server/modules/tasks/tasks.store";
import { requestTaskCancel } from "~/server/modules/tasks/tasks.lifecycle";
import { repoMutex } from "~/server/core/repository-mutex";
import { cache, cacheKeys } from "~/server/utils/cache";
import { db } from "~/server/db/db";
import { backupSchedulesTable } from "~/server/db/schema";

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

describe("startMirrorStatus", () => {
	test("persists the missing snapshots as the task result", async () => {
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

		const result = await backupsService.startMirrorStatus(schedule.shortId, mirrorRepository.shortId as ShortId);

		expect(result).toEqual({ taskId: expect.any(String), status: "started" });
		await waitForExpect(() => {
			const task = taskStore.findById({ organizationId: TEST_ORG_ID, taskId: result.taskId });
			expect(task).toMatchObject({
				kind: "mirrorStatus",
				status: "succeeded",
				input: {
					kind: "mirrorStatus",
					scheduleId: schedule.id,
					sourceRepositoryId: repository.id,
					mirrorRepositoryId: mirrorRepository.shortId,
				},
				result: {
					kind: "mirrorStatus",
					sourceCount: 3,
					mirrorCount: 1,
					missingSnapshots: [
						{ short_id: "bbb", time: "2025-01-02T10:00:00Z", size: 200 },
						{ short_id: "ccc", time: "2025-01-03T10:00:00Z", size: 300 },
					],
				},
			});
		});
	});

	test("reuses an active lookup only for the same organization and source repository", async () => {
		setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const replacementRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});
		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);

		let releaseSnapshots: (() => void) | undefined;
		const snapshotsReleased = new Promise<void>((resolve) => {
			releaseSnapshots = resolve;
		});
		vi.spyOn(resticModule.restic, "snapshots").mockImplementation(() => {
			return Effect.promise(async () => {
				await snapshotsReleased;
				return [] as never;
			});
		});

		const first = await backupsService.startMirrorStatus(schedule.shortId, mirrorRepository.shortId as ShortId);
		const duplicate = await backupsService.startMirrorStatus(schedule.shortId, mirrorRepository.shortId as ShortId);

		expect(duplicate.taskId).toBe(first.taskId);

		await db
			.update(backupSchedulesTable)
			.set({ repositoryId: replacementRepository.id })
			.where(eq(backupSchedulesTable.id, schedule.id));
		const changedSource = await backupsService.startMirrorStatus(
			schedule.shortId,
			mirrorRepository.shortId as ShortId,
		);

		expect(changedSource.taskId).not.toBe(first.taskId);
		releaseSnapshots?.();
		await waitForExpect(() => {
			expect(taskStore.findById({ organizationId: TEST_ORG_ID, taskId: first.taskId })?.status).toBe("succeeded");
			expect(taskStore.findById({ organizationId: TEST_ORG_ID, taskId: changedSource.taskId })?.status).toBe(
				"succeeded",
			);
		});
	});

	test("does not share an active lookup across organizations", async () => {
		setup();
		const otherOrganizationId = "mirror-status-other-org";
		await createTestOrganization({ id: otherOrganizationId });
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({ volumeId: volume.id, repositoryId: repository.id });
		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);
		const otherVolume = await createTestVolume({ organizationId: otherOrganizationId });
		const otherRepository = await createTestRepository({ organizationId: otherOrganizationId });
		const otherMirrorRepository = await createTestRepository({ organizationId: otherOrganizationId });
		const otherSchedule = await createTestBackupSchedule({
			organizationId: otherOrganizationId,
			volumeId: otherVolume.id,
			repositoryId: otherRepository.id,
		});
		await createTestBackupScheduleMirror(otherSchedule.id, otherMirrorRepository.id);

		let releaseSnapshots: (() => void) | undefined;
		const snapshotsReleased = new Promise<void>((resolve) => {
			releaseSnapshots = resolve;
		});
		vi.spyOn(resticModule.restic, "snapshots").mockImplementation(() =>
			Effect.promise(async () => {
				await snapshotsReleased;
				return [] as never;
			}),
		);

		const first = await backupsService.startMirrorStatus(schedule.shortId, mirrorRepository.shortId as ShortId);
		vi.mocked(context.getOrganizationId).mockReturnValue(otherOrganizationId);
		const second = await backupsService.startMirrorStatus(
			otherSchedule.shortId,
			otherMirrorRepository.shortId as ShortId,
		);

		expect(second.taskId).not.toBe(first.taskId);
		releaseSnapshots?.();
		await waitForExpect(() => {
			expect(taskStore.findById({ organizationId: TEST_ORG_ID, taskId: first.taskId })?.status).toBe("succeeded");
			expect(taskStore.findById({ organizationId: otherOrganizationId, taskId: second.taskId })?.status).toBe(
				"succeeded",
			);
		});
	});

	test("cancels an in-progress snapshot lookup", async () => {
		setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({ volumeId: volume.id, repositoryId: repository.id });
		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);

		let resolveSnapshotsStarted: (() => void) | undefined;
		const snapshotsStarted = new Promise<void>((resolve) => {
			resolveSnapshotsStarted = resolve;
		});
		vi.spyOn(resticModule.restic, "snapshots").mockImplementation((_config, options) =>
			Effect.promise(
				() =>
					new Promise<never>((_, reject) => {
						options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
						resolveSnapshotsStarted?.();
					}),
			),
		);

		const result = await backupsService.startMirrorStatus(schedule.shortId, mirrorRepository.shortId as ShortId);
		await snapshotsStarted;
		expect(requestTaskCancel(result.taskId)).toBe(true);

		await waitForExpect(() => {
			expect(taskStore.findById({ organizationId: TEST_ORG_ID, taskId: result.taskId })?.status).toBe(
				"cancelled",
			);
		});
	});

	test.each([1, 2])("aborts the peer when lookup %s fails and waits for cleanup", async (failingCall) => {
		setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({ volumeId: volume.id, repositoryId: repository.id });
		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);

		const failure = Promise.withResolvers<never>();
		const peerStarted = Promise.withResolvers<void>();
		const peerAborted = Promise.withResolvers<void>();
		const peerCleanup = Promise.withResolvers<void>();
		let aborted = false;
		let peerCleaned = false;
		let callCount = 0;
		vi.spyOn(resticModule.restic, "snapshots").mockImplementation((_config, options) => {
			callCount++;
			if (callCount === failingCall) {
				return Effect.tryPromise({ try: () => failure.promise, catch: (error) => error }) as never;
			}

			return Effect.tryPromise(async () => {
				options?.signal?.addEventListener(
					"abort",
					() => {
						aborted = true;
						peerAborted.resolve();
					},
					{ once: true },
				);
				peerStarted.resolve();
				await peerAborted.promise;
				await peerCleanup.promise;
				peerCleaned = true;
				throw new DOMException("Peer aborted", "AbortError");
			}) as never;
		});

		const result = await backupsService.startMirrorStatus(schedule.shortId, mirrorRepository.shortId as ShortId);
		await peerStarted.promise;
		failure.reject(new Error("Repository lookup failed"));
		try {
			await waitForExpect(() => expect(aborted).toBe(true), 1000);
			expect(taskStore.findById({ organizationId: TEST_ORG_ID, taskId: result.taskId })?.status).toBe("running");
			expect(repoMutex.isLocked(repository.id)).toBe(true);
			expect(repoMutex.isLocked(mirrorRepository.id)).toBe(true);
			expect(peerCleaned).toBe(false);
		} finally {
			peerAborted.resolve();
			peerCleanup.resolve();
		}
		await waitForExpect(() => {
			expect(peerCleaned).toBe(true);
			expect(taskStore.findById({ organizationId: TEST_ORG_ID, taskId: result.taskId })).toMatchObject({
				status: "failed",
				error: "Repository lookup failed",
			});
			expect(repoMutex.isLocked(repository.id)).toBe(false);
			expect(repoMutex.isLocked(mirrorRepository.id)).toBe(false);
		});
	});

	test("throws if mirror is not configured for the schedule", async () => {
		setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const unrelatedRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		await expect(
			backupsService.startMirrorStatus(schedule.shortId, unrelatedRepository.shortId as ShortId),
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
			targetDisplayName: schedule.name,
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
