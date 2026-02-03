import { test, describe, mock, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { backupsService } from "../backups.service";
import { backupsExecutionService } from "../backups.execution";
import { createTestVolume } from "~/test/helpers/volume";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { createTestRepository } from "~/test/helpers/repository";
import { createTestBackupScheduleMirror } from "~/test/helpers/backup-mirror";
import { generateBackupOutput } from "~/test/helpers/restic";
import { TEST_ORG_ID } from "~/test/helpers/organization";
import * as context from "~/server/core/request-context";
import * as spawnModule from "~/server/utils/spawn";
import { restic } from "~/server/utils/restic";
import { NotFoundError, BadRequestError } from "http-errors-enhanced";

const resticBackupMock = mock(() => Promise.resolve({ exitCode: 0, summary: generateBackupOutput(), error: "" }));
const resticForgetMock = mock(() => Promise.resolve({ success: true }));
const resticCopyMock = mock(() => Promise.resolve({ success: true, output: "" }));

beforeEach(() => {
	resticBackupMock.mockClear();
	resticForgetMock.mockClear();
	resticCopyMock.mockClear();
	spyOn(spawnModule, "safeSpawn").mockImplementation(resticBackupMock);
	spyOn(restic, "forget").mockImplementation(resticForgetMock);
	spyOn(restic, "copy").mockImplementation(resticCopyMock);
	spyOn(context, "getOrganizationId").mockReturnValue(TEST_ORG_ID);
});

afterEach(() => {
	mock.restore();
});

describe("backup execution - validation failures", () => {
	test("should fail backup when volume is not mounted", async () => {
		// arrange
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

	test("should fail backup when volume does not exist", async () => {
		// arrange
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: 99999,
			repositoryId: repository.id,
		});

		// act
		const result = await backupsExecutionService.validateBackupExecution(schedule.id);

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
		const volume = await createTestVolume();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: "non-existent-repo",
		});

		// act
		const result = await backupsExecutionService.validateBackupExecution(schedule.id);

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
	test("should stop a running backup", async () => {
		// arrange
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		resticBackupMock.mockImplementation(async () => {
			await new Promise((resolve) => setTimeout(resolve, 500));
			return { exitCode: 0, summary: generateBackupOutput(), error: "" };
		});

		void backupsExecutionService.executeBackup(schedule.id);
		await new Promise((resolve) => setTimeout(resolve, 50));

		// act
		await backupsExecutionService.stopBackup(schedule.id);

		// assert
		const updatedSchedule = await backupsService.getScheduleById(schedule.id);
		expect(updatedSchedule.lastBackupStatus).toBe("warning");
		expect(updatedSchedule.lastBackupError).toBe("Backup was stopped by user");
	});

	test("should throw ConflictError when trying to stop non-running backup", async () => {
		// arrange
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		// act & assert
		expect(backupsExecutionService.stopBackup(schedule.id)).rejects.toThrow(
			"No backup is currently running for this schedule",
		);
	});

	test("should throw NotFoundError when schedule does not exist", async () => {
		// act & assert
		expect(backupsExecutionService.stopBackup(99999)).rejects.toThrow("Backup schedule not found");
	});
});

describe("retention policy - runForget", () => {
	test("should execute forget with retention policy", async () => {
		// arrange
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
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			repositoryId: repository.id,
			retentionPolicy: undefined,
		});

		// act & assert
		expect(backupsExecutionService.runForget(schedule.id)).rejects.toThrow(
			"No retention policy configured for this schedule",
		);
	});

	test("should throw NotFoundError when schedule does not exist", async () => {
		// act & assert
		expect(backupsExecutionService.runForget(99999)).rejects.toThrow("Backup schedule not found");
	});

	test("should throw NotFoundError when repository does not exist", async () => {
		// arrange
		const schedule = await createTestBackupSchedule({
			repositoryId: "non-existent-repo",
			retentionPolicy: {
				keepHourly: 24,
			},
		});

		// act & assert
		expect(backupsExecutionService.runForget(schedule.id)).rejects.toThrow("Repository not found");
	});
});

describe("mirror operations", () => {
	test("should copy snapshots to mirror repositories", async () => {
		// arrange
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

	test("should update mirror status on failure", async () => {
		// arrange
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

		await new Promise((resolve) => setTimeout(resolve, 100));

		// assert
		expect(resticForgetMock).toHaveBeenCalledWith(
			mirrorRepository.config,
			expect.objectContaining({ keepHourly: 24, keepDaily: 7 }),
			expect.objectContaining({ tag: schedule.shortId, organizationId: TEST_ORG_ID }),
		);
	});

	test("should not run forget on mirror when no retention policy", async () => {
		// arrange
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

		await new Promise((resolve) => setTimeout(resolve, 100));

		// assert
		expect(resticForgetMock).not.toHaveBeenCalled();
	});
});
