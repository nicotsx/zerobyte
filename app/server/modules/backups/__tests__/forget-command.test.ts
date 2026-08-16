import { Effect } from "effect";
import waitForExpect from "wait-for-expect";
import { afterEach, describe, expect, test, vi } from "vitest";
import { restic } from "~/server/core/restic";
import { repoMutex } from "~/server/core/repository-mutex";
import { requestTaskCancel } from "~/server/modules/tasks/tasks.lifecycle";
import { taskStore } from "~/server/modules/tasks/tasks.store";
import { TEST_ORG_ID } from "~/test/helpers/organization";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { createTestRepository } from "~/test/helpers/repository";
import { createForgetCommand } from "../commands/forget-command";

const setup = () => {
	const resticForgetMock = vi.fn(() => Effect.succeed({ success: true, data: null }));
	const resticStatsMock = vi.fn(() =>
		Effect.succeed({
			total_size: 0,
			total_uncompressed_size: 0,
			compression_ratio: 0,
			compression_progress: 0,
			compression_space_saving: 0,
			snapshots_count: 0,
		}),
	);

	vi.spyOn(restic, "forget").mockImplementation(resticForgetMock);
	vi.spyOn(restic, "stats").mockImplementation(resticStatsMock);

	return { resticForgetMock };
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("forget command", () => {
	test("rejects a manual request while another retention task is queued", async () => {
		const { resticForgetMock } = setup();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			repositoryId: repository.id,
			retentionPolicy: { keepDaily: 7 },
		});
		const releaseLock = await repoMutex.acquireExclusive(repository.id, "test-retention-task");

		try {
			const firstTask = createForgetCommand({
				organizationId: TEST_ORG_ID,
				scheduleId: schedule.id,
				scheduleShortId: schedule.shortId,
				targetDisplayName: schedule.name,
				repository,
				retentionPolicy: { keepDaily: 7 },
				trigger: "manual",
			}).start();
			await waitForExpect(() => {
				expect(taskStore.findById({ organizationId: TEST_ORG_ID, taskId: firstTask.taskId })?.status).toBe(
					"queued",
				);
			});

			expect(() =>
				createForgetCommand({
					organizationId: TEST_ORG_ID,
					scheduleId: schedule.id,
					scheduleShortId: schedule.shortId,
					targetDisplayName: schedule.name,
					repository,
					retentionPolicy: { keepDaily: 7 },
					trigger: "manual",
				}).start(),
			).toThrow("Retention policy is already being applied");
			expect(resticForgetMock).not.toHaveBeenCalled();
			expect(requestTaskCancel(firstTask.taskId)).toBe(true);
		} finally {
			releaseLock();
		}
	});

	test("coalesces a queued manual task with the latest post-backup policy", async () => {
		const { resticForgetMock } = setup();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			repositoryId: repository.id,
			retentionPolicy: { keepHourly: 24 },
		});
		const releaseLock = await repoMutex.acquireExclusive(repository.id, "test-retention-task");
		let manualTaskId = "";

		try {
			const manualTask = createForgetCommand({
				organizationId: TEST_ORG_ID,
				scheduleId: schedule.id,
				scheduleShortId: schedule.shortId,
				targetDisplayName: schedule.name,
				repository,
				retentionPolicy: { keepHourly: 24 },
				trigger: "manual",
			}).start();
			manualTaskId = manualTask.taskId;
			const latestRetentionPolicy = { keepLast: 3 };
			const postBackupTask = createForgetCommand({
				organizationId: TEST_ORG_ID,
				scheduleId: schedule.id,
				scheduleShortId: schedule.shortId,
				targetDisplayName: schedule.name,
				repository,
				retentionPolicy: latestRetentionPolicy,
				trigger: "postBackup",
			}).start();

			expect(postBackupTask).toEqual({ taskId: manualTaskId, status: "queued" });
			expect(resticForgetMock).not.toHaveBeenCalled();
		} finally {
			releaseLock();
		}

		await waitForExpect(() => {
			expect(taskStore.findById({ organizationId: TEST_ORG_ID, taskId: manualTaskId })?.status).toBe("succeeded");
		});
		expect(resticForgetMock).toHaveBeenCalledWith(
			repository.config,
			{ keepLast: 3 },
			expect.objectContaining({ tag: schedule.shortId, organizationId: TEST_ORG_ID }),
		);
	});

	test("cancels a queued manual task when the post-backup policy is removed", async () => {
		const { resticForgetMock } = setup();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			repositoryId: repository.id,
			retentionPolicy: { keepHourly: 24 },
		});
		const releaseLock = await repoMutex.acquireExclusive(repository.id, "test-retention-task");

		try {
			const manualTask = createForgetCommand({
				organizationId: TEST_ORG_ID,
				scheduleId: schedule.id,
				scheduleShortId: schedule.shortId,
				targetDisplayName: schedule.name,
				repository,
				retentionPolicy: { keepHourly: 24 },
				trigger: "manual",
			}).start();
			const postBackupTask = createForgetCommand({
				organizationId: TEST_ORG_ID,
				scheduleId: schedule.id,
				scheduleShortId: schedule.shortId,
				targetDisplayName: schedule.name,
				repository,
				retentionPolicy: null,
				trigger: "postBackup",
			}).start();

			expect(postBackupTask).toEqual({ status: "cancelled" });
			await waitForExpect(() => {
				expect(taskStore.findById({ organizationId: TEST_ORG_ID, taskId: manualTask.taskId })?.status).toBe(
					"cancelled",
				);
			});
			expect(resticForgetMock).not.toHaveBeenCalled();
		} finally {
			releaseLock();
		}
	});

	test("remains cancelled when Restic resolves after cancellation", async () => {
		const { resticForgetMock } = setup();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({ repositoryId: repository.id });
		let completeForget: (() => void) | undefined;
		const forgetCompletion = new Promise<void>((resolve) => {
			completeForget = resolve;
		});
		resticForgetMock.mockImplementationOnce(() =>
			Effect.promise(async () => {
				await forgetCompletion;
				return { success: true, data: null };
			}),
		);

		const startedTask = createForgetCommand({
			organizationId: TEST_ORG_ID,
			scheduleId: schedule.id,
			scheduleShortId: schedule.shortId,
			targetDisplayName: schedule.name,
			repository,
			retentionPolicy: { keepDaily: 7 },
			trigger: "manual",
		}).start();
		await waitForExpect(() => {
			expect(resticForgetMock).toHaveBeenCalledTimes(1);
		});

		expect(requestTaskCancel(startedTask.taskId)).toBe(true);
		expect(completeForget).toBeDefined();
		completeForget?.();

		await waitForExpect(() => {
			expect(taskStore.findById({ organizationId: TEST_ORG_ID, taskId: startedTask.taskId })?.status).toBe(
				"cancelled",
			);
		});
	});

	test("persists and executes the supplied retention policy", async () => {
		const { resticForgetMock } = setup();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({ repositoryId: repository.id });
		const retentionPolicy = {
			keepHourly: 24,
			keepDaily: 7,
			keepWeekly: 4,
			keepMonthly: 12,
			keepYearly: 3,
		};

		const startedTask = createForgetCommand({
			organizationId: TEST_ORG_ID,
			scheduleId: schedule.id,
			scheduleShortId: schedule.shortId,
			targetDisplayName: schedule.name,
			repository,
			retentionPolicy,
			trigger: "manual",
		}).start();
		await waitForExpect(() => {
			expect(taskStore.findById({ organizationId: TEST_ORG_ID, taskId: startedTask.taskId })?.status).toBe(
				"succeeded",
			);
		});

		expect(resticForgetMock).toHaveBeenCalledWith(
			repository.config,
			retentionPolicy,
			expect.objectContaining({ tag: schedule.shortId, organizationId: TEST_ORG_ID }),
		);
		expect(taskStore.findById({ organizationId: TEST_ORG_ID, taskId: startedTask.taskId })).toMatchObject({
			kind: "forget",
			resourceType: "backup_schedule",
			resourceId: schedule.shortId,
			input: {
				kind: "forget",
				scheduleId: schedule.id,
				scheduleShortId: schedule.shortId,
				repositoryId: repository.shortId,
				retentionPolicy,
				trigger: "manual",
			},
			result: { kind: "forget" },
		});
	});
});
