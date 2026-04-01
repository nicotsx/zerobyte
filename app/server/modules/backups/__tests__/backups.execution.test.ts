import waitForExpect from "wait-for-expect";
import { afterEach, describe, expect, test, vi } from "vitest";
import { backupsService } from "../backups.service";
import { backupsExecutionService } from "../backups.execution";
import { createTestVolume } from "~/test/helpers/volume";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { createTestRepository } from "~/test/helpers/repository";
import { createTestBackupScheduleMirror } from "~/test/helpers/backup-mirror";
import { generateBackupOutput } from "~/test/helpers/restic";
import { TEST_ORG_ID } from "~/test/helpers/organization";
import * as context from "~/server/core/request-context";
import * as spawnModule from "@zerobyte/core/node";
import type { SafeSpawnParams } from "@zerobyte/core/node";
import { restic } from "~/server/core/restic";
import { NotFoundError, BadRequestError } from "http-errors-enhanced";
import { repositoriesService } from "~/server/modules/repositories/repositories.service";
import { repoMutex } from "~/server/core/repository-mutex";

const setup = () => {
	const resticBackupMock = vi.fn((_: SafeSpawnParams) =>
		Promise.resolve({ exitCode: 0, summary: generateBackupOutput(), error: "" }),
	);
	const resticForgetMock = vi.fn(() => Promise.resolve({ success: true, data: null }));
	const resticCopyMock = vi.fn(() => Promise.resolve({ success: true, output: "" }));
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
	vi.spyOn(context, "getOrganizationId").mockReturnValue(TEST_ORG_ID);

	return {
		resticBackupMock,
		resticForgetMock,
		resticCopyMock,
		refreshStatsMock,
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
		const result = await backupsExecutionService.validateBackupExecution(schedule.id);

		// assert
		expect(result.type).toBe("failure");
		if (result.type === "failure") {
			expect(result.error).toBeInstanceOf(BadRequestError);
			expect(result.error.message).toBe("Volume is not mounted");
		}
		expect(resticBackupMock).not.toHaveBeenCalled();
	});

	test("should fail backup when schedule does not exist", async () => {
		setup();
		// act
		const result = await backupsExecutionService.validateBackupExecution(99999);

		// assert
		expect(result.type).toBe("failure");
		if (result.type === "failure") {
			expect(result.error).toBeInstanceOf(NotFoundError);
			expect(result.error.message).toBe("Backup schedule not found");
		}
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

		await backupsExecutionService.executeBackup(schedule.id);

		const updatedSchedule = await backupsService.getScheduleById(schedule.id);
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

		await backupsExecutionService.executeBackup(schedule.id);

		const updatedSchedule = await backupsService.getScheduleById(schedule.id);
		expect(updatedSchedule.lastBackupStatus).toBe("error");
		expect(updatedSchedule.lastBackupError).toBe(
			"Permissions 0755 for '/tmp/zerobyte-ssh-key' are too open.\nThis private key will be ignored.",
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

		const executePromise = backupsExecutionService.executeBackup(schedule.id);

		await waitForExpect(async () => {
			const runningSchedule = await backupsService.getScheduleById(schedule.id);
			expect(runningSchedule.lastBackupStatus).toBe("in_progress");
		});

		// act
		await backupsExecutionService.stopBackup(schedule.id);
		await executePromise;

		// assert
		const updatedSchedule = await backupsService.getScheduleById(schedule.id);
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

		vi.spyOn(repoMutex, "acquireShared").mockImplementation((_repositoryId, _operation, signal) => {
			return new Promise((_, reject) => {
				if (signal?.aborted) {
					reject(signal.reason instanceof Error ? signal.reason : new Error("Operation aborted"));
					return;
				}

				signal?.addEventListener(
					"abort",
					() => {
						reject(signal.reason instanceof Error ? signal.reason : new Error("Operation aborted"));
					},
					{ once: true },
				);
			});
		});

		const executePromise = backupsExecutionService.executeBackup(schedule.id);

		await waitForExpect(async () => {
			const queuedSchedule = await backupsService.getScheduleById(schedule.id);
			expect(queuedSchedule.lastBackupStatus).toBe("in_progress");
		});

		expect(resticBackupMock).not.toHaveBeenCalled();

		await backupsExecutionService.stopBackup(schedule.id);
		await executePromise;

		const updatedSchedule = await backupsService.getScheduleById(schedule.id);
		expect(updatedSchedule.lastBackupStatus).toBe("warning");
		expect(updatedSchedule.lastBackupError).toBe("Backup was stopped by the user");
		expect(resticBackupMock).not.toHaveBeenCalled();
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
		await expect(backupsExecutionService.stopBackup(schedule.id)).rejects.toThrow(
			"No backup is currently running for this schedule",
		);

		const updatedSchedule = await backupsService.getScheduleById(schedule.id);
		expect(updatedSchedule.lastBackupAt).toBe(previousLastBackupAt);
		expect(updatedSchedule.lastBackupStatus).toBe("warning");
		expect(updatedSchedule.lastBackupError).toBe("Backup was stopped by the user");
	});

	test("should throw NotFoundError when schedule does not exist", async () => {
		setup();
		// act & assert
		await expect(backupsExecutionService.stopBackup(99999)).rejects.toThrow("Backup schedule not found");
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
		await backupsExecutionService.runForget(schedule.id);

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
		await expect(backupsExecutionService.runForget(schedule.id)).rejects.toThrow(
			"No retention policy configured for this schedule",
		);
	});

	test("should throw NotFoundError when schedule does not exist", async () => {
		setup();
		// act & assert
		await expect(backupsExecutionService.runForget(99999)).rejects.toThrow("Backup schedule not found");
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
		await expect(backupsExecutionService.runForget(schedule.id, "non-existent-repo")).rejects.toThrow(
			"Repository not found",
		);
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
		await backupsExecutionService.copyToMirrors(schedule.id, sourceRepository, null);

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
		await backupsExecutionService.copyToMirrors(schedule.id, sourceRepository, null);

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
		await backupsExecutionService.copyToMirrors(schedule.id, sourceRepository, null);

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
		await backupsExecutionService.copyToMirrors(schedule.id, sourceRepository, null);

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
		await backupsExecutionService.copyToMirrors(schedule.id, sourceRepository, null);

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
		await backupsExecutionService.copyToMirrors(schedule.id, sourceRepository, schedule.retentionPolicy);

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
		await backupsExecutionService.copyToMirrors(schedule.id, sourceRepository, schedule.retentionPolicy);

		await waitForExpect(() => {
			expect(resticCopyMock).toHaveBeenCalled();
		});

		// assert
		expect(resticForgetMock).not.toHaveBeenCalled();
	});
});
