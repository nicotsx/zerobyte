import waitForExpect from "wait-for-expect";
import { afterEach, describe, expect, test, vi } from "vitest";
import { backupsService } from "../backups.service";
import { createTestVolume } from "~/test/helpers/volume";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { createTestRepository } from "~/test/helpers/repository";
import { createTestBackupScheduleMirror } from "~/test/helpers/backup-mirror";
import { generateBackupOutput } from "~/test/helpers/restic";
import { TEST_ORG_ID } from "~/test/helpers/organization";
import * as context from "~/server/core/request-context";
import * as spawnModule from "@zerobyte/core/node";
import type { SafeSpawnParams } from "@zerobyte/core/node";
import { logger } from "@zerobyte/core/node";
import { restic } from "~/server/core/restic";
import { NotFoundError, BadRequestError } from "http-errors-enhanced";
import { fromAny } from "@total-typescript/shoehorn";
import { scheduleQueries } from "../backups.queries";
import { repositoriesService } from "~/server/modules/repositories/repositories.service";
import { repoMutex } from "~/server/core/repository-mutex";
import { notificationsService } from "~/server/modules/notifications/notifications.service";
import { agentManager } from "~/server/modules/agents/agents-manager";
import { createAgentBackupMocks } from "~/test/helpers/agent-mock";
import { getScheduleByIdOrShortId } from "../helpers/backup-schedule-lookups";
import { volumeService } from "~/server/modules/volumes/volume.service";
import { db } from "~/server/db/db";

const setup = () => {
	const resticBackupMock = vi.fn((_: SafeSpawnParams) =>
		Promise.resolve({ exitCode: 0, summary: generateBackupOutput(), error: "" }),
	);
	const resticForgetMock = vi.fn(() => Promise.resolve({ success: true, data: null }));
	const resticCopyMock = vi.fn(() => Promise.resolve({ success: true, output: "" }));
	const { runBackupMock, cancelBackupMock } = createAgentBackupMocks(resticBackupMock);
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
	vi.spyOn(agentManager, "cancelBackup").mockImplementation(cancelBackupMock);
	vi.spyOn(context, "getOrganizationId").mockReturnValue(TEST_ORG_ID);
	const ensureHealthyVolumeMock = vi.spyOn(volumeService, "ensureHealthyVolume").mockImplementation(async (shortId) => {
		const volume = await db.query.volumesTable.findFirst({
			where: {
				AND: [{ shortId: { eq: shortId } }, { organizationId: TEST_ORG_ID }],
			},
		});

		if (!volume) {
			throw new NotFoundError("Volume not found");
		}

		if (volume.status !== "mounted") {
			return {
				ready: false as const,
				volume,
				reason: "Volume is not mounted",
			};
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
		runBackupMock,
		cancelBackupMock,
		refreshStatsMock,
		ensureHealthyVolumeMock,
	};
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("backup execution - validation failures", () => {
	test("should fail backup when volume is not mounted", async () => {
		// arrange
		const { resticBackupMock } = setup();
		const volume = await createTestVolume({ status: "unmounted" });
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		// act
		const result = await backupsService.validateBackupExecution(schedule.id);

		// assert
		expect(result.type).toBe("failure");
		if (result.type === "failure") {
			expect(result.error).toBeInstanceOf(BadRequestError);
			expect(result.error.message).toBe("Volume is not mounted");
		}
		expect(resticBackupMock).not.toHaveBeenCalled();
	});

	test("runs a preflight volume health check before starting a backup", async () => {
		setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});
		const ensureHealthyVolumeSpy = vi.spyOn(volumeService, "ensureHealthyVolume").mockResolvedValue({
			ready: true,
			volume,
			remounted: false,
		});

		const result = await backupsService.validateBackupExecution(schedule.id);

		expect(result.type).toBe("success");
		expect(ensureHealthyVolumeSpy).toHaveBeenCalledWith(volume.shortId);
	});

	test("fails validation when the preflight health check cannot recover the volume", async () => {
		const { resticBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});
		vi.spyOn(volumeService, "ensureHealthyVolume").mockResolvedValue({
			ready: false,
			volume: { ...volume, status: "error", lastError: "stale mount" },
			reason: "stale mount",
		});

		const result = await backupsService.validateBackupExecution(schedule.id);

		expect(result.type).toBe("failure");
		if (result.type === "failure") {
			expect(result.error).toBeInstanceOf(BadRequestError);
			expect(result.error.message).toBe("stale mount");
		}
		expect(resticBackupMock).not.toHaveBeenCalled();
	});

	test("should fail backup when volume does not exist", async () => {
		// arrange
		setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		const hydratedSchedule = await scheduleQueries.findById(schedule.id, TEST_ORG_ID);
		expect(hydratedSchedule).toBeDefined();
		const scheduleWithoutVolume = {
			...hydratedSchedule,
			volume: null,
		};
		vi.spyOn(scheduleQueries, "findById").mockResolvedValueOnce(fromAny(scheduleWithoutVolume));

		// act
		const result = await backupsService.validateBackupExecution(schedule.id);

		// assert
		expect(result.type).toBe("failure");
		if (result.type === "failure") {
			expect(result.error).toBeInstanceOf(NotFoundError);
			expect(result.error.message).toBe("Volume not found");
			expect(result.partialContext?.schedule).toBeDefined();
		}
	});

	test("should fail backup when repository does not exist", async () => {
		// arrange
		setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		const hydratedSchedule = await scheduleQueries.findById(schedule.id, TEST_ORG_ID);
		expect(hydratedSchedule).toBeDefined();
		const scheduleWithoutRepository = {
			...hydratedSchedule,
			repository: null,
		};
		vi.spyOn(scheduleQueries, "findById").mockResolvedValueOnce(fromAny(scheduleWithoutRepository));

		// act
		const result = await backupsService.validateBackupExecution(schedule.id);

		// assert
		expect(result.type).toBe("failure");
		if (result.type === "failure") {
			expect(result.error).toBeInstanceOf(NotFoundError);
			expect(result.error.message).toBe("Repository not found");
			expect(result.partialContext?.schedule).toBeDefined();
			expect(result.partialContext?.volume).toBeDefined();
		}
	});
	test("should fail backup when schedule does not exist", async () => {
		setup();
		// act
		const result = await backupsService.validateBackupExecution(99999);

		// assert
		expect(result.type).toBe("failure");
		if (result.type === "failure") {
			expect(result.error).toBeInstanceOf(NotFoundError);
			expect(result.error.message).toBe("Backup schedule not found");
		}
	});

	test("does not claim retries when none were scheduled", async () => {
		const { resticBackupMock } = setup();
		const notificationSpy = vi.spyOn(notificationsService, "sendBackupNotification").mockResolvedValue();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			cronExpression: "* * * * *",
			maxRetries: 2,
			retryDelay: 15 * 60 * 1000,
		});

		resticBackupMock.mockImplementationOnce(() =>
			Promise.resolve({ exitCode: 1, summary: generateBackupOutput(), error: "failed" }),
		);

		await backupsService.executeBackup(schedule.id);

		expect(notificationSpy).toHaveBeenCalled();
		expect(notificationSpy.mock.calls.at(-1)?.[2]?.error).toBe("failed");
	});

	test("does not log an invalid cron error for manual-only failures", async () => {
		const { resticBackupMock } = setup();
		const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			enabled: false,
			cronExpression: "",
		});

		resticBackupMock.mockImplementationOnce(() =>
			Promise.resolve({ exitCode: 1, summary: generateBackupOutput(), error: "manual failure" }),
		);

		await backupsService.executeBackup(schedule.id, true);

		expect(
			errorSpy.mock.calls.some(([message]) => String(message).includes('Failed to parse cron expression ""')),
		).toBe(false);
	});

	test("passes configured backup webhooks to the backup agent", async () => {
		const { runBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const backupWebhooks = {
			pre: {
				url: "http://localhost:8080/stop",
				headers: ["authorization: Bearer stop-token"],
				body: '{"action":"stop"}',
			},
			post: {
				url: "http://localhost:8080/start",
				headers: ["authorization: Bearer start-token"],
				body: '{"action":"start"}',
			},
		};

		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			backupWebhooks,
		});

		await backupsService.executeBackup(schedule.id);

		expect(runBackupMock).toHaveBeenCalledWith(
			"local",
			expect.objectContaining({
				payload: expect.objectContaining({
					webhooks: backupWebhooks,
				}),
			}),
		);
	});

	test("should fail backup when the local agent is unavailable", async () => {
		const { runBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		runBackupMock.mockResolvedValueOnce({
			status: "unavailable",
			error: new Error("Local backup agent is not connected"),
		});

		await backupsService.executeBackup(schedule.id);

		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(updatedSchedule.lastBackupStatus).toBe("error");
		expect(updatedSchedule.lastBackupError).toBe("Local backup agent is not connected");
	});
});

describe("stop backup", () => {
	test("should keep restic warning details when backup completes with read errors", async () => {
		const { resticBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		resticBackupMock.mockImplementationOnce((params: SafeSpawnParams) => {
			params.onStderr?.("error: open /mnt/data/private.db: permission denied");

			return Promise.resolve({
				exitCode: 3,
				summary: generateBackupOutput(),
				error: "Warning: at least one source file could not be read",
			});
		});

		await backupsService.executeBackup(schedule.id);

		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(updatedSchedule.lastBackupStatus).toBe("warning");
		expect(updatedSchedule.lastBackupError).toBe("error: open /mnt/data/private.db: permission denied");
	});

	test("should store restic diagnostic details instead of the generic summary on hard failure", async () => {
		const { resticBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		resticBackupMock.mockImplementationOnce((params: SafeSpawnParams) => {
			params.onStderr?.("Permissions 0755 for '/tmp/zerobyte-ssh-key' are too open.");
			params.onStderr?.("This private key will be ignored.");

			return Promise.resolve({
				exitCode: 1,
				summary: "",
				error: "ssh command exited",
				stderr: "Permissions 0755 for '/tmp/zerobyte-ssh-key' are too open.\nThis private key will be ignored.",
			});
		});

		await backupsService.executeBackup(schedule.id);

		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(updatedSchedule.lastBackupStatus).toBe("error");
		expect(updatedSchedule.lastBackupError).toBe(
			"Permissions 0755 for '/tmp/zerobyte-ssh-key' are too open.\nThis private key will be ignored.",
		);
	});

	test("should settle and mark the backup as failed when the backup process throws", async () => {
		const { resticBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		resticBackupMock.mockImplementationOnce(() => Promise.reject(new Error("restic crashed")));

		const result = await Promise.race([
			backupsService.executeBackup(schedule.id).then(() => "settled"),
			new Promise<string>((resolve) => setTimeout(() => resolve("timed-out"), 100)),
		]);

		expect(result).toBe("settled");

		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(updatedSchedule.lastBackupStatus).toBe("error");
		expect(updatedSchedule.lastBackupError).toBe("Error: restic crashed");
	});

	test("should block forget on the same repository until the active backup completes", async () => {
		const { resticBackupMock, resticForgetMock, runBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			retentionPolicy: { keepHourly: 24 },
		});

		let completeBackup: (() => void) | undefined;
		resticBackupMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					completeBackup = () => resolve({ exitCode: 0, summary: generateBackupOutput(), error: "" });
				}),
		);

		const backupPromise = backupsService.executeBackup(schedule.id);

		await waitForExpect(() => {
			expect(runBackupMock).toHaveBeenCalledTimes(1);
		});

		let forgetFinished = false;
		const forgetPromise = backupsService.runForget(schedule.id).finally(() => {
			forgetFinished = true;
		});

		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(resticForgetMock).not.toHaveBeenCalled();
		expect(forgetFinished).toBe(false);

		expect(completeBackup).toBeDefined();
		completeBackup?.();

		await backupPromise;
		await forgetPromise;

		expect(resticForgetMock).toHaveBeenCalled();
		expect(resticForgetMock).toHaveBeenCalledWith(
			repository.config,
			expect.objectContaining({ keepHourly: 24 }),
			expect.objectContaining({ tag: schedule.shortId, organizationId: TEST_ORG_ID }),
		);
	});

	test("should stop a running backup", async () => {
		// arrange
		const { resticBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		resticBackupMock.mockImplementation(({ signal }: SafeSpawnParams) => {
			return new Promise((resolve) => {
				if (signal?.aborted) {
					resolve({ exitCode: 1, summary: "", error: "" });
					return;
				}

				signal?.addEventListener(
					"abort",
					() => {
						resolve({ exitCode: 1, summary: "", error: "" });
					},
					{ once: true },
				);
			});
		});

		const executePromise = backupsService.executeBackup(schedule.id);

		await waitForExpect(async () => {
			const runningSchedule = await getScheduleByIdOrShortId(schedule.id);
			expect(runningSchedule.lastBackupStatus).toBe("in_progress");
		});

		// act
		await backupsService.stopBackup(schedule.id);
		await executePromise;

		// assert
		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(updatedSchedule.lastBackupStatus).toBe("warning");
		expect(updatedSchedule.lastBackupError).toBe("Backup was stopped by the user");
	});

	test("should stop a running backup when the cancel command cannot be delivered", async () => {
		const { resticBackupMock, cancelBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		resticBackupMock.mockImplementation(() => new Promise(() => {}));
		cancelBackupMock.mockResolvedValueOnce(false);

		const executePromise = backupsService.executeBackup(schedule.id);

		await waitForExpect(async () => {
			const runningSchedule = await getScheduleByIdOrShortId(schedule.id);
			expect(runningSchedule.lastBackupStatus).toBe("in_progress");
		});

		await backupsService.stopBackup(schedule.id);
		await executePromise;

		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(updatedSchedule.lastBackupStatus).toBe("warning");
		expect(updatedSchedule.lastBackupError).toBe("Backup was stopped by the user");
	});

	test("should stop a queued backup before it acquires the repository lock", async () => {
		const { resticBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		const releaseLock = await repoMutex.acquireExclusive(repository.id, "test");
		const executePromise = backupsService.executeBackup(schedule.id);

		try {
			await waitForExpect(async () => {
				const queuedSchedule = await getScheduleByIdOrShortId(schedule.id);
				expect(queuedSchedule.lastBackupStatus).toBe("in_progress");
			});

			expect(resticBackupMock).not.toHaveBeenCalled();

			await backupsService.stopBackup(schedule.id);
		} finally {
			releaseLock();
		}

		await executePromise;

		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(updatedSchedule.lastBackupStatus).toBe("warning");
		expect(updatedSchedule.lastBackupError).toBe("Backup was stopped by the user");
		expect(resticBackupMock).not.toHaveBeenCalled();
	});

	test("should clear failureRetryCount when a scheduled retry is cancelled", async () => {
		const { resticBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			cronExpression: "0 0 1 1 *",
			maxRetries: 3,
			retryDelay: 60 * 1000,
		});

		resticBackupMock.mockImplementationOnce(() =>
			Promise.resolve({ exitCode: 1, summary: generateBackupOutput(), error: "retry me" }),
		);

		await backupsService.executeBackup(schedule.id);

		const failedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(failedSchedule.failureRetryCount).toBe(1);

		resticBackupMock.mockImplementationOnce(({ signal }: SafeSpawnParams) => {
			return new Promise((resolve) => {
				if (signal?.aborted) {
					resolve({ exitCode: 1, summary: "", error: "" });
					return;
				}

				signal?.addEventListener(
					"abort",
					() => {
						resolve({ exitCode: 1, summary: "", error: "" });
					},
					{ once: true },
				);
			});
		});

		const executePromise = backupsService.executeBackup(schedule.id);

		await waitForExpect(async () => {
			const retryingSchedule = await getScheduleByIdOrShortId(schedule.id);
			expect(retryingSchedule.lastBackupStatus).toBe("in_progress");
		});

		await backupsService.stopBackup(schedule.id);
		await executePromise;

		const cancelledSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(cancelledSchedule.lastBackupStatus).toBe("warning");
		expect(cancelledSchedule.failureRetryCount).toBe(0);
	});

	test("should throw ConflictError when trying to stop non-running backup", async () => {
		// arrange
		setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const previousLastBackupAt = 1_700_000_000_000;
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			lastBackupAt: previousLastBackupAt,
			lastBackupStatus: "in_progress",
		});

		// act & assert
		await expect(backupsService.stopBackup(schedule.id)).rejects.toThrow(
			"No backup is currently running for this schedule",
		);

		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(updatedSchedule.lastBackupAt).toBe(previousLastBackupAt);
		expect(updatedSchedule.lastBackupStatus).toBe("warning");
		expect(updatedSchedule.lastBackupError).toBe("Backup was stopped by the user");
	});

	test("should reset a stuck in_progress status even when no backup is running", async () => {
		// arrange
		setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			lastBackupStatus: "in_progress",
		});

		// act
		await backupsService.stopBackup(schedule.id).catch(() => {});

		// assert
		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(updatedSchedule.lastBackupStatus).toBe("warning");
		expect(updatedSchedule.lastBackupError).toBe("Backup was stopped by the user");
	});

	test("should throw NotFoundError when schedule does not exist", async () => {
		setup();
		// act & assert
		await expect(backupsService.stopBackup(99999)).rejects.toThrow("Backup schedule not found");
	});
});

describe("retention policy - runForget", () => {
	test("should execute forget with retention policy", async () => {
		// arrange
		const { resticForgetMock } = setup();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			repositoryId: repository.id,
			retentionPolicy: {
				keepHourly: 24,
				keepDaily: 7,
				keepWeekly: 4,
				keepMonthly: 12,
				keepYearly: 3,
			},
		});

		// act
		await backupsService.runForget(schedule.id);

		// assert
		expect(resticForgetMock).toHaveBeenCalledWith(
			repository.config,
			expect.objectContaining({
				keepHourly: 24,
				keepDaily: 7,
				keepWeekly: 4,
				keepMonthly: 12,
				keepYearly: 3,
			}),
			expect.objectContaining({
				tag: schedule.shortId,
				organizationId: TEST_ORG_ID,
			}),
		);
	});

	test("should throw BadRequestError if no retention policy configured", async () => {
		// arrange
		setup();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			repositoryId: repository.id,
			retentionPolicy: undefined,
		});

		// act & assert
		await expect(backupsService.runForget(schedule.id)).rejects.toThrow(
			"No retention policy configured for this schedule",
		);
	});

	test("should throw NotFoundError when schedule does not exist", async () => {
		setup();
		// act & assert
		await expect(backupsService.runForget(99999)).rejects.toThrow("Backup schedule not found");
	});

	test("should throw NotFoundError when repository does not exist", async () => {
		// arrange
		setup();
		const schedule = await createTestBackupSchedule({
			retentionPolicy: {
				keepHourly: 24,
			},
		});

		// act & assert
		await expect(backupsService.runForget(schedule.id, "non-existent-repo")).rejects.toThrow("Repository not found");
	});
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
		await backupsService.copyToMirrors(schedule.id, sourceRepository, null);

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

	test("should skip disabled mirrors", async () => {
		// arrange
		const { resticCopyMock } = setup();
		const volume = await createTestVolume();
		const sourceRepository = await createTestRepository();
		const mirrorRepository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: sourceRepository.id,
		});

		await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id, { enabled: false });

		// act
		await backupsService.copyToMirrors(schedule.id, sourceRepository, null);

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
		await backupsService.copyToMirrors(schedule.id, sourceRepository, null);

		// assert
		const mirrors = await backupsService.getMirrors(schedule.id);
		const updatedMirror = mirrors.find((m) => m.id === mirror.id);
		expect(updatedMirror?.lastCopyStatus).toBe("success");
		expect(updatedMirror?.lastCopyError).toBeNull();
		expect(updatedMirror?.lastCopyAt).not.toBeNull();
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

		resticCopyMock.mockImplementationOnce(async () => {
			await backupsService.updateMirrors(schedule.id, {
				mirrors: [{ repositoryId: mirrorRepository.id, enabled: true }],
			});
			return { success: true, output: "" };
		});

		// act
		await backupsService.copyToMirrors(schedule.id, sourceRepository, null);

		// assert
		const mirrors = await backupsService.getMirrors(schedule.id);
		expect(mirrors).toHaveLength(1);
		expect(mirrors[0]?.id).not.toBe(originalMirror.id);
		expect(mirrors[0]?.lastCopyStatus).toBe("success");
		expect(mirrors[0]?.lastCopyError).toBeNull();
		expect(mirrors[0]?.lastCopyAt).not.toBeNull();
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

		resticCopyMock.mockImplementationOnce(() => Promise.reject(new Error("Copy failed")));

		// act
		await backupsService.copyToMirrors(schedule.id, sourceRepository, null);

		// assert
		const mirrors = await backupsService.getMirrors(schedule.id);
		const updatedMirror = mirrors.find((m) => m.id === mirror.id);
		expect(updatedMirror?.lastCopyStatus).toBe("error");
		expect(updatedMirror?.lastCopyError).toBe("Copy failed");
		expect(updatedMirror?.lastCopyAt).not.toBeNull();
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
		resticCopyMock.mockImplementation(() => Promise.resolve({ success: true, output: "" }));

		// act
		await backupsService.copyToMirrors(schedule.id, sourceRepository, schedule.retentionPolicy);

		await waitForExpect(() => {
			expect(resticCopyMock).toHaveBeenCalled();
		});

		// assert
		expect(resticForgetMock).toHaveBeenCalledWith(
			mirrorRepository.config,
			expect.objectContaining({ keepHourly: 24, keepDaily: 7 }),
			expect.objectContaining({ tag: schedule.shortId, organizationId: TEST_ORG_ID }),
		);
	});

	test("should not run forget on mirror when no retention policy", async () => {
		// arrange
		const { resticCopyMock, resticForgetMock } = setup();
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
		await backupsService.copyToMirrors(schedule.id, sourceRepository, schedule.retentionPolicy);

		await waitForExpect(() => {
			expect(resticCopyMock).toHaveBeenCalled();
		});

		// assert
		expect(resticForgetMock).not.toHaveBeenCalled();
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

		resticCopyMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveFirstCopyStarted();
					releaseFirstCopy = () => resolve({ success: true, output: "" });
				}),
		);
		resticCopyMock.mockImplementation(() => Promise.resolve({ success: true, output: "" }));

		const firstCopyPromise = backupsService.copyToMirrors(firstSchedule.id, sourceRepository, null);
		await firstCopyStarted;

		const secondCopyPromise = backupsService.copyToMirrors(secondSchedule.id, sourceRepository, null);

		try {
			const secondCopyState = await Promise.race<"resolved" | "timeout">([
				secondCopyPromise.then(() => "resolved"),
				new Promise((resolve) => {
					setTimeout(() => resolve("timeout"), 50);
				}),
			]);

			expect(secondCopyState).toBe("timeout");
			expect(resticCopyMock).toHaveBeenCalledTimes(1);
		} finally {
			releaseFirstCopy();
			await Promise.all([firstCopyPromise, secondCopyPromise]);
		}

		expect(resticCopyMock).toHaveBeenCalledTimes(2);
	});
});
