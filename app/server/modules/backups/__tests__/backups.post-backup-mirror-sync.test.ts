import waitForExpect from "wait-for-expect";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { SafeSpawnParams } from "@zerobyte/core/node";
import * as spawnModule from "@zerobyte/core/node";
import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { backupsService } from "../backups.service";
import { commands } from "../commands";
import { createTestVolume } from "~/test/helpers/volume";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { createTestRepository } from "~/test/helpers/repository";
import { createTestBackupScheduleMirror } from "~/test/helpers/backup-mirror";
import { generateBackupOutput } from "~/test/helpers/restic";
import { TEST_ORG_ID } from "~/test/helpers/organization";
import { createAgentBackupMocks } from "~/test/helpers/agent-mock";
import * as context from "~/server/core/request-context";
import { restic } from "~/server/core/restic";
import { repositoriesService } from "~/server/modules/repositories/repositories.service";
import { agentManager } from "~/server/modules/agents/agents-manager";
import { volumeService } from "~/server/modules/volumes/volume.service";
import { taskStore } from "~/server/modules/tasks/tasks.store";
import { getScheduleByIdOrShortId } from "../helpers/backup-schedule-lookups";
import { db } from "~/server/db/db";
import { backupSchedulesTable } from "~/server/db/schema";
import { NotFoundError } from "http-errors-enhanced";

const setup = () => {
	const resticBackupMock = vi.fn((_: SafeSpawnParams) =>
		Promise.resolve({ exitCode: 0, summary: generateBackupOutput(), error: "" }),
	);
	const resticForgetMock = vi.fn(() => Effect.succeed({ success: true, data: null }));
	const resticCopyMock = vi.fn(() => Effect.succeed({ success: true }));
	const { runBackupMock } = createAgentBackupMocks(resticBackupMock);
	const refreshStatsMock = vi.fn(() =>
		Promise.resolve({
			total_size: 0,
			total_uncompressed_size: 0,
			compression_ratio: 0,
			compression_progress: 0,
			compression_space_saving: 0,
			snapshots_count: 0,
		}),
	);

	vi.spyOn(spawnModule, "safeSpawn").mockImplementation(resticBackupMock);
	vi.spyOn(restic, "forget").mockImplementation(resticForgetMock);
	vi.spyOn(restic, "copy").mockImplementation(resticCopyMock);
	vi.spyOn(repositoriesService, "refreshRepositoryStats").mockImplementation(refreshStatsMock);
	vi.spyOn(agentManager, "runBackup").mockImplementation(runBackupMock);
	vi.spyOn(context, "getOrganizationId").mockReturnValue(TEST_ORG_ID);
	vi.spyOn(volumeService, "ensureHealthyVolume").mockImplementation(async (shortId) => {
		const volume = await db.query.volumesTable.findFirst({
			where: {
				AND: [{ shortId: { eq: shortId } }, { organizationId: TEST_ORG_ID }],
			},
		});

		if (!volume) {
			throw new NotFoundError("Volume not found");
		}

		return {
			ready: true as const,
			volume,
			remounted: false,
		};
	});

	return {
		resticBackupMock,
		resticForgetMock,
		resticCopyMock,
		refreshStatsMock,
	};
};

const getBackupTaskForSchedule = (scheduleId: number) =>
	db.query.tasksTable.findFirst({
		where: {
			AND: [
				{ organizationId: TEST_ORG_ID },
				{ kind: "backup" },
				{ resourceType: "backup_schedule" },
				{ resourceId: String(scheduleId) },
			],
		},
	});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("mirror operations", () => {
	test("should copy snapshots to mirror repositories", async () => {
		// arrange
		const { resticCopyMock } = setup();
		const volume = await createTestVolume();
		const sourceRepository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: sourceRepository.id,
		});

		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);

		// act
		await backupsService.executeBackup(schedule.id);
		await waitForExpect(() => {
			expect(resticCopyMock).toHaveBeenCalled();
		});

		// assert
		expect(resticCopyMock).toHaveBeenCalledWith(
			sourceRepository.config,
			mirrorRepository.config,
			expect.objectContaining({
				tag: schedule.shortId,
				organizationId: TEST_ORG_ID,
			}),
		);
	});

	test("should pass custom restic params to mirror copy", async () => {
		// arrange
		const { resticCopyMock } = setup();
		const volume = await createTestVolume();
		const sourceRepository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: sourceRepository.id,
			customResticParams: ["--pack-size 64", "--ignore-inode"],
		});

		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);

		// act
		await backupsService.executeBackup(schedule.id);
		await waitForExpect(() => {
			expect(resticCopyMock).toHaveBeenCalled();
		});

		// assert
		expect(resticCopyMock).toHaveBeenCalledWith(
			sourceRepository.config,
			mirrorRepository.config,
			expect.objectContaining({
				tag: schedule.shortId,
				organizationId: TEST_ORG_ID,
				customResticParams: ["--pack-size 64", "--ignore-inode"],
			}),
		);
	});

	test("should skip disabled mirrors", async () => {
		// arrange
		const { resticCopyMock, refreshStatsMock } = setup();
		const volume = await createTestVolume();
		const sourceRepository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: sourceRepository.id,
		});

		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id, { enabled: false });

		// act
		await backupsService.executeBackup(schedule.id);
		await waitForExpect(() => {
			expect(refreshStatsMock).toHaveBeenCalled();
		});

		// assert
		expect(resticCopyMock).not.toHaveBeenCalled();
	});

	test("should update mirror status on success", async () => {
		// arrange
		setup();
		const volume = await createTestVolume();
		const sourceRepository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: sourceRepository.id,
		});

		const mirror = await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);

		// act
		await backupsService.executeBackup(schedule.id);

		// assert
		await waitForExpect(async () => {
			const mirrors = await backupsService.getMirrors(schedule.id);
			const updatedMirror = mirrors.find((m) => m.id === mirror.id);
			expect(updatedMirror?.lastSyncTask?.status).toBe("succeeded");
			expect(updatedMirror?.lastSyncTask?.error).toBeNull();
			expect(updatedMirror?.lastSyncTask?.finishedAt).not.toBeNull();
		});
	});

	test("should finalize mirror status when mirror settings are updated during copy", async () => {
		// arrange
		const { resticCopyMock } = setup();
		const volume = await createTestVolume();
		const sourceRepository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: sourceRepository.id,
		});

		const originalMirror = await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);

		resticCopyMock.mockImplementationOnce(() =>
			Effect.promise(async () => {
				await backupsService.updateMirrors(schedule.id, {
					mirrors: [{ repositoryId: mirrorRepository.id, enabled: true }],
				});
				return { success: true };
			}),
		);

		// act
		await backupsService.executeBackup(schedule.id);

		// assert
		await waitForExpect(async () => {
			const mirrors = await backupsService.getMirrors(schedule.id);
			expect(mirrors).toHaveLength(1);
			expect(mirrors[0]?.id).not.toBe(originalMirror.id);
			expect(mirrors[0]?.lastSyncTask?.status).toBe("succeeded");
			expect(mirrors[0]?.lastSyncTask?.error).toBeNull();
			expect(mirrors[0]?.lastSyncTask?.finishedAt).not.toBeNull();
		});
	});

	test("should update mirror status on failure", async () => {
		// arrange
		const { resticCopyMock } = setup();
		const volume = await createTestVolume();
		const sourceRepository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: sourceRepository.id,
		});

		const mirror = await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);

		resticCopyMock.mockImplementationOnce(() =>
			Effect.sync(() => {
				throw new Error("Copy failed");
			}),
		);

		// act
		await backupsService.executeBackup(schedule.id);

		// assert
		await waitForExpect(async () => {
			const mirrors = await backupsService.getMirrors(schedule.id);
			const updatedMirror = mirrors.find((m) => m.id === mirror.id);
			expect(updatedMirror?.lastSyncTask?.status).toBe("failed");
			expect(updatedMirror?.lastSyncTask?.error).toBe("Copy failed");
			expect(updatedMirror?.lastSyncTask?.finishedAt).not.toBeNull();
		});
	});

	test("should run forget on mirror after successful copy when retention policy exists", async () => {
		// arrange
		const { resticCopyMock, resticForgetMock } = setup();
		const volume = await createTestVolume();
		const sourceRepository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: sourceRepository.id,
			retentionPolicy: { keepHourly: 24, keepDaily: 7 },
		});

		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);

		resticCopyMock.mockClear();
		resticCopyMock.mockImplementation(() => Effect.succeed({ success: true }));

		// act
		await backupsService.executeBackup(schedule.id);

		// assert
		await waitForExpect(() => {
			expect(resticCopyMock).toHaveBeenCalled();
			expect(resticForgetMock).toHaveBeenCalledWith(
				mirrorRepository.config,
				expect.objectContaining({ keepHourly: 24, keepDaily: 7 }),
				expect.objectContaining({ tag: schedule.shortId, organizationId: TEST_ORG_ID }),
			);
		});
	});

	test("should not run forget on mirror when no retention policy", async () => {
		// arrange
		const { resticForgetMock, refreshStatsMock } = setup();
		const volume = await createTestVolume();
		const sourceRepository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: sourceRepository.id,
			retentionPolicy: undefined,
		});

		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);

		resticForgetMock.mockClear();

		// act
		await backupsService.executeBackup(schedule.id);

		await waitForExpect(() => {
			expect(refreshStatsMock).toHaveBeenCalled();
		});

		// assert
		expect(resticForgetMock).not.toHaveBeenCalled();
	});

	test("uses the current retention policy when a backup finishes", async () => {
		const { resticBackupMock, resticCopyMock, resticForgetMock } = setup();
		const volume = await createTestVolume();
		const sourceRepository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: sourceRepository.id,
			retentionPolicy: { keepHourly: 24 },
		});
		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);

		resticBackupMock.mockImplementationOnce(async () => {
			await db
				.update(backupSchedulesTable)
				.set({ retentionPolicy: null })
				.where(eq(backupSchedulesTable.id, schedule.id));
			return { exitCode: 0, summary: generateBackupOutput(), error: "" };
		});

		await backupsService.executeBackup(schedule.id);

		await waitForExpect(async () => {
			const mirrors = await backupsService.getMirrors(schedule.id);
			expect(resticCopyMock).toHaveBeenCalled();
			expect(resticForgetMock).not.toHaveBeenCalled();
			expect(mirrors[0]?.lastSyncTask?.status).toBe("succeeded");
		});
	});

	test("keeps a completed backup successful when mirror synchronization cannot be started", async () => {
		const { resticBackupMock, resticCopyMock } = setup();
		const volume = await createTestVolume();
		const sourceRepository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: sourceRepository.id,
		});
		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);
		resticBackupMock.mockResolvedValueOnce({ exitCode: 0, summary: "not-json", error: "" });

		await backupsService.executeBackup(schedule.id, true);

		const task = await getBackupTaskForSchedule(schedule.id);
		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(task?.status).toBe("succeeded");
		expect(task?.error).toBeNull();
		expect(updatedSchedule.lastBackupStatus).toBe("success");
		expect(resticCopyMock).not.toHaveBeenCalled();
	});

	test("continues enqueueing mirrors when one mirror task cannot be created", async () => {
		const { resticCopyMock } = setup();
		const volume = await createTestVolume();
		const sourceRepository = await createTestRepository();
		const failingMirrorRepository = await createTestRepository();
		const successfulMirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: sourceRepository.id,
		});
		await createTestBackupScheduleMirror(schedule.id, failingMirrorRepository.id);
		await createTestBackupScheduleMirror(schedule.id, successfulMirrorRepository.id);
		const createMirrorSync = commands.createMirrorSync;
		vi.spyOn(commands, "createMirrorSync").mockImplementation((plan) => {
			if (plan.mirrorRepository.id === failingMirrorRepository.id) {
				return {
					start: () => {
						throw new Error("Task persistence failed");
					},
				};
			}
			return createMirrorSync(plan);
		});

		await backupsService.executeBackup(schedule.id, true);

		const task = await getBackupTaskForSchedule(schedule.id);
		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(task?.status).toBe("succeeded");
		expect(updatedSchedule.lastBackupStatus).toBe("success");
		await waitForExpect(() => {
			expect(resticCopyMock).toHaveBeenCalledWith(
				sourceRepository.config,
				successfulMirrorRepository.config,
				expect.any(Object),
			);
		});
		expect(resticCopyMock).not.toHaveBeenCalledWith(
			sourceRepository.config,
			failingMirrorRepository.config,
			expect.any(Object),
		);
	});

	test("mirrors from the repository used by the completed backup", async () => {
		const { resticBackupMock, resticCopyMock } = setup();
		const volume = await createTestVolume();
		const sourceRepository = await createTestRepository();
		const replacementRepository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: sourceRepository.id,
		});
		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);

		resticBackupMock.mockImplementationOnce(async () => {
			await db
				.update(backupSchedulesTable)
				.set({ repositoryId: replacementRepository.id })
				.where(eq(backupSchedulesTable.id, schedule.id));
			return { exitCode: 0, summary: generateBackupOutput(), error: "" };
		});

		await backupsService.executeBackup(schedule.id);

		await waitForExpect(() => {
			expect(resticCopyMock).toHaveBeenCalledWith(
				sourceRepository.config,
				mirrorRepository.config,
				expect.any(Object),
			);
		});
	});

	test("keeps the mirror execution plan stable after the task starts", async () => {
		const { resticCopyMock, resticForgetMock } = setup();
		const volume = await createTestVolume();
		const sourceRepository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const retentionPolicy = { keepHourly: 24 };
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: sourceRepository.id,
			retentionPolicy,
		});
		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);

		resticCopyMock.mockImplementationOnce(() =>
			Effect.promise(async () => {
				await db
					.update(backupSchedulesTable)
					.set({ retentionPolicy: null })
					.where(eq(backupSchedulesTable.id, schedule.id));
				return { success: true };
			}),
		);

		await backupsService.executeBackup(schedule.id);

		await waitForExpect(() => {
			expect(resticForgetMock).toHaveBeenCalledWith(
				mirrorRepository.config,
				retentionPolicy,
				expect.objectContaining({ tag: schedule.shortId, organizationId: TEST_ORG_ID }),
			);
		});
	});

	test("should serialize mirror copies for schedules that share the same mirror repository", async () => {
		const { resticCopyMock } = setup();
		const sourceRepository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const firstVolume = await createTestVolume();
		const secondVolume = await createTestVolume();
		const firstSchedule = await createTestBackupSchedule({
			volumeId: firstVolume.id,
			repositoryId: sourceRepository.id,
		});
		const secondSchedule = await createTestBackupSchedule({
			volumeId: secondVolume.id,
			repositoryId: sourceRepository.id,
		});

		await createTestBackupScheduleMirror(firstSchedule.id, mirrorRepository.id);
		await createTestBackupScheduleMirror(secondSchedule.id, mirrorRepository.id);

		let releaseFirstCopy = () => {};
		let resolveFirstCopyStarted = () => {};
		const firstCopyStarted = new Promise<void>((resolve) => {
			resolveFirstCopyStarted = resolve;
		});

		resticCopyMock.mockImplementationOnce(() =>
			Effect.promise(
				() =>
					new Promise((resolve) => {
						resolveFirstCopyStarted();
						releaseFirstCopy = () => resolve({ success: true });
					}),
			),
		);
		resticCopyMock.mockImplementation(() => Effect.succeed({ success: true }));

		await backupsService.executeBackup(firstSchedule.id);
		await firstCopyStarted;

		await backupsService.executeBackup(secondSchedule.id);

		try {
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(resticCopyMock).toHaveBeenCalledTimes(1);
		} finally {
			releaseFirstCopy();
		}

		await waitForExpect(() => {
			expect(resticCopyMock).toHaveBeenCalledTimes(2);
		});
	});

	test("queues each completed snapshot while a manual sync is active", async () => {
		const { resticBackupMock, resticCopyMock, refreshStatsMock } = setup();
		const volume = await createTestVolume();
		const sourceRepository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: sourceRepository.id,
		});
		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);
		resticBackupMock
			.mockResolvedValueOnce({
				exitCode: 0,
				summary: generateBackupOutput().replace("abcd1234", "snapshot-from-first-backup"),
				error: "",
			})
			.mockResolvedValueOnce({
				exitCode: 0,
				summary: generateBackupOutput().replace("abcd1234", "snapshot-from-second-backup"),
				error: "",
			});

		let releaseManualCopy = () => {};
		const manualCopyStarted = new Promise<void>((resolve) => {
			resticCopyMock.mockImplementationOnce(() =>
				Effect.promise(
					() =>
						new Promise((copyResolve) => {
							resolve();
							releaseManualCopy = () => copyResolve({ success: true });
						}),
				),
			);
		});

		await backupsService.startMirrorSync(schedule.shortId, mirrorRepository.shortId, ["snapshot-1"]);
		await manualCopyStarted;
		await backupsService.executeBackup(schedule.id);
		await backupsService.executeBackup(schedule.id);
		await waitForExpect(() => {
			expect(refreshStatsMock).toHaveBeenCalled();
		});
		const activeTaskResource = {
			organizationId: TEST_ORG_ID,
			kind: "mirrorSync" as const,
			resourceType: "backup_schedule" as const,
			resourceId: schedule.shortId,
			operationKey: mirrorRepository.shortId,
		};

		try {
			expect(taskStore.listActive(activeTaskResource)).toHaveLength(2);
			expect(resticCopyMock).toHaveBeenCalledTimes(1);
		} finally {
			releaseManualCopy();
		}

		await waitForExpect(() => {
			expect(taskStore.listActive(activeTaskResource)).toHaveLength(0);
		});
		expect(resticCopyMock).toHaveBeenCalledTimes(2);
		expect(resticCopyMock).toHaveBeenCalledWith(
			sourceRepository.config,
			mirrorRepository.config,
			expect.objectContaining({
				snapshotIds: ["snapshot-from-first-backup", "snapshot-from-second-backup"],
			}),
		);
	});

	test("does not merge queued syncs from different source repositories", async () => {
		const { resticCopyMock, refreshStatsMock } = setup();
		const volume = await createTestVolume();
		const firstSourceRepository = await createTestRepository();
		const secondSourceRepository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: firstSourceRepository.id,
		});
		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id);

		let releaseManualCopy = () => {};
		const manualCopyStarted = new Promise<void>((resolve) => {
			resticCopyMock.mockImplementationOnce(() =>
				Effect.promise(
					() =>
						new Promise((copyResolve) => {
							resolve();
							releaseManualCopy = () => copyResolve({ success: true });
						}),
				),
			);
		});

		await backupsService.startMirrorSync(schedule.shortId, mirrorRepository.shortId, ["manual-snapshot"]);
		await manualCopyStarted;
		await backupsService.executeBackup(schedule.id);
		await db
			.update(backupSchedulesTable)
			.set({ repositoryId: secondSourceRepository.id })
			.where(eq(backupSchedulesTable.id, schedule.id));
		await backupsService.executeBackup(schedule.id);
		await waitForExpect(() => {
			expect(refreshStatsMock).toHaveBeenCalledTimes(2);
		});

		const activeTaskResource = {
			organizationId: TEST_ORG_ID,
			kind: "mirrorSync" as const,
			resourceType: "backup_schedule" as const,
			resourceId: schedule.shortId,
			operationKey: mirrorRepository.shortId,
		};

		try {
			const activeTasks = taskStore.listActive(activeTaskResource);
			const sourceRepositoryIds: string[] = [];
			for (const task of activeTasks) {
				if (task.input.kind === "mirrorSync" && task.input.sourceRepositoryId) {
					sourceRepositoryIds.push(task.input.sourceRepositoryId);
				}
			}
			expect(activeTasks).toHaveLength(3);
			expect(sourceRepositoryIds).toEqual(
				expect.arrayContaining([firstSourceRepository.id, secondSourceRepository.id]),
			);
		} finally {
			releaseManualCopy();
		}

		await waitForExpect(() => {
			expect(resticCopyMock).toHaveBeenCalledWith(
				secondSourceRepository.config,
				mirrorRepository.config,
				expect.any(Object),
			);
		});
	});
});
