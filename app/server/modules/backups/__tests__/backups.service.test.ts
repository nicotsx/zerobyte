import { test, describe, mock, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { backupsService } from "../backups.service";
import { createTestVolume } from "~/test/helpers/volume";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { createTestRepository } from "~/test/helpers/repository";
import { generateBackupOutput } from "~/test/helpers/restic";
import { faker } from "@faker-js/faker";
import * as spawnModule from "~/server/utils/spawn";
import { TEST_ORG_ID } from "~/test/helpers/organization";
import * as context from "~/server/core/request-context";

const resticBackupMock = mock(() => Promise.resolve({ exitCode: 0, summary: "", error: "" }));

beforeEach(() => {
	resticBackupMock.mockClear();
	spyOn(spawnModule, "safeSpawn").mockImplementation(resticBackupMock);
	spyOn(context, "getOrganizationId").mockReturnValue(TEST_ORG_ID);
});

afterEach(() => {
	mock.restore();
});

describe("execute backup", () => {
	test("should correctly set next backup time", async () => {
		// arrange
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			cronExpression: "*/5 * * * *",
		});
		expect(schedule.nextBackupAt).toBeNull();

		resticBackupMock.mockImplementationOnce(() =>
			Promise.resolve({ exitCode: 0, summary: generateBackupOutput(), error: "" }),
		);

		// act
		await backupsService.executeBackup(schedule.id);

		// assert
		const updatedSchedule = await backupsService.getScheduleById(schedule.id);
		expect(updatedSchedule.nextBackupAt).not.toBeNull();

		const nextBackupAt = new Date(updatedSchedule.nextBackupAt ?? 0);
		const now = new Date();

		expect(nextBackupAt.getTime()).toBeGreaterThanOrEqual(now.getTime());
		expect(nextBackupAt.getTime() - now.getTime()).toBeLessThanOrEqual(5 * 60 * 1000);
	});

	test("should skip backup if schedule is disabled", async () => {
		// arrange
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			enabled: false,
		});

		// act
		await backupsService.executeBackup(schedule.id);

		// assert
		expect(resticBackupMock).not.toHaveBeenCalled();
	});

	test("should execute backup if schedule is disabled but the run is manual", async () => {
		// arrange
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			enabled: false,
		});

		resticBackupMock.mockImplementationOnce(() =>
			Promise.resolve({ exitCode: 0, summary: generateBackupOutput(), error: "" }),
		);

		// act
		await backupsService.executeBackup(schedule.id, true);

		// assert
		expect(resticBackupMock).toHaveBeenCalled();
	});

	test("should skip the backup if the previous one is still running", async () => {
		// arrange
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		resticBackupMock.mockImplementation(async () => {
			await new Promise((resolve) => setTimeout(resolve, 100));
			return Promise.resolve({ exitCode: 0, summary: generateBackupOutput(), error: "" });
		});

		// act
		void backupsService.executeBackup(schedule.id);
		await new Promise((resolve) => setTimeout(resolve, 10));
		await backupsService.executeBackup(schedule.id);

		// assert
		expect(resticBackupMock).toHaveBeenCalledTimes(1);
	});

	test("should set the backup status to failed if restic returns a 3 exit code", async () => {
		// arrange
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		resticBackupMock.mockImplementationOnce(() =>
			Promise.resolve({ exitCode: 3, summary: generateBackupOutput(), error: "Some error occurred" }),
		);

		// act
		await backupsService.executeBackup(schedule.id);

		// assert
		const updatedSchedule = await backupsService.getScheduleById(schedule.id);
		expect(updatedSchedule.lastBackupStatus).toBe("warning");
	});

	test("should set the backup status to failed if restic returns a non zero exit code", async () => {
		// arrange
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		resticBackupMock.mockImplementationOnce(() =>
			Promise.resolve({ exitCode: 1, summary: generateBackupOutput(), error: "Some error occurred" }),
		);

		// act
		await backupsService.executeBackup(schedule.id);

		// assert
		const updatedSchedule = await backupsService.getScheduleById(schedule.id);
		expect(updatedSchedule.lastBackupStatus).toBe("error");
	});
});

describe("getSchedulesToExecute", () => {
	test("should return schedules with NULL lastBackupStatus", async () => {
		// arrange
		const volume = await createTestVolume();
		const repository = await createTestRepository();

		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			enabled: true,
			cronExpression: "* * * * *",
			lastBackupStatus: null,
			nextBackupAt: faker.date.past().getTime(),
		});

		// act
		const schedulesToExecute = await backupsService.getSchedulesToExecute();

		// assert
		expect(schedulesToExecute).toContain(schedule.id);
	});
});
