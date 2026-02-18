import waitForExpect from "wait-for-expect";
import { test, describe, mock, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { eq } from "drizzle-orm";
import { backupsService } from "../backups.service";
import { createTestVolume } from "~/test/helpers/volume";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { createTestRepository } from "~/test/helpers/repository";
import { generateBackupOutput } from "~/test/helpers/restic";
import { faker } from "@faker-js/faker";
import * as spawnModule from "~/server/utils/spawn";
import { db } from "~/server/db/db";
import { backupScheduleMirrorsTable, repositoriesTable, volumesTable } from "~/server/db/schema";
import { TEST_ORG_ID } from "~/test/helpers/organization";
import * as context from "~/server/core/request-context";
import { backupsExecutionService } from "../backups.execution";

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
		await backupsExecutionService.executeBackup(schedule.id);

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
		await backupsExecutionService.executeBackup(schedule.id);

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
		await backupsExecutionService.executeBackup(schedule.id, true);

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
		void backupsExecutionService.executeBackup(schedule.id);

		await waitForExpect(() => {
			expect(resticBackupMock).toHaveBeenCalledTimes(1);
		});

		await backupsExecutionService.executeBackup(schedule.id);

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
		await backupsExecutionService.executeBackup(schedule.id);

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
		await backupsExecutionService.executeBackup(schedule.id);

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
		const schedulesToExecute = await backupsExecutionService.getSchedulesToExecute();

		// assert
		expect(schedulesToExecute).toContain(schedule.id);
	});
});

describe("getScheduleByIdOrShortId", () => {
	test("should resolve a schedule by numeric id string", async () => {
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		const found = await backupsService.getScheduleByIdOrShortId(String(schedule.id));

		expect(found.id).toBe(schedule.id);
		expect(found.shortId).toBe(schedule.shortId);
	});

	test("should resolve a schedule by short id", async () => {
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		const found = await backupsService.getScheduleByIdOrShortId(schedule.shortId);

		expect(found.id).toBe(schedule.id);
		expect(found.shortId).toBe(schedule.shortId);
	});

	test("should not return schedules from another organization", async () => {
		const otherOrgId = faker.string.uuid();
		const schedule = await createTestBackupSchedule({
			organizationId: otherOrgId,
		});

		expect(backupsService.getScheduleByIdOrShortId(schedule.shortId)).rejects.toThrow("Backup schedule not found");
		expect(backupsService.getScheduleByIdOrShortId(schedule.id)).rejects.toThrow("Backup schedule not found");
	});
});

describe("listSchedules", () => {
	test("should ignore schedules with missing relations", async () => {
		const healthyVolume = await createTestVolume();
		const healthyRepository = await createTestRepository();
		const healthySchedule = await createTestBackupSchedule({
			volumeId: healthyVolume.id,
			repositoryId: healthyRepository.id,
		});

		const orphanVolume = await createTestVolume();
		const orphanRepository = await createTestRepository();
		const orphanSchedule = await createTestBackupSchedule({
			volumeId: orphanVolume.id,
			repositoryId: orphanRepository.id,
		});

		await db.delete(volumesTable).where(eq(volumesTable.id, orphanVolume.id));

		const schedules = await backupsService.listSchedules();

		expect(schedules.map((schedule) => schedule.id)).toContain(healthySchedule.id);
		expect(schedules.map((schedule) => schedule.id)).not.toContain(orphanSchedule.id);
	});

	test("should ignore schedules with missing repository relation", async () => {
		const healthyVolume = await createTestVolume();
		const healthyRepository = await createTestRepository();
		const healthySchedule = await createTestBackupSchedule({
			volumeId: healthyVolume.id,
			repositoryId: healthyRepository.id,
		});

		const orphanVolume = await createTestVolume();
		const orphanRepository = await createTestRepository();
		const orphanSchedule = await createTestBackupSchedule({
			volumeId: orphanVolume.id,
			repositoryId: orphanRepository.id,
		});

		await db.delete(repositoriesTable).where(eq(repositoriesTable.id, orphanRepository.id));

		const schedules = await backupsService.listSchedules();

		expect(schedules.map((schedule) => schedule.id)).toContain(healthySchedule.id);
		expect(schedules.map((schedule) => schedule.id)).not.toContain(orphanSchedule.id);
	});
});

describe("cleanupOrphanedSchedules", () => {
	test("should return zero when cascades already removed orphaned schedules", async () => {
		const healthyVolume = await createTestVolume();
		const healthyRepository = await createTestRepository();
		const healthySchedule = await createTestBackupSchedule({
			volumeId: healthyVolume.id,
			repositoryId: healthyRepository.id,
		});

		const orphanVolume = await createTestVolume();
		const orphanRepository = await createTestRepository();
		const orphanSchedule = await createTestBackupSchedule({
			volumeId: orphanVolume.id,
			repositoryId: orphanRepository.id,
		});

		const mirrorRepository = await createTestRepository();
		await db.insert(backupScheduleMirrorsTable).values({
			scheduleId: orphanSchedule.id,
			repositoryId: mirrorRepository.id,
			enabled: true,
		});

		await db.delete(volumesTable).where(eq(volumesTable.id, orphanVolume.id));

		const cleanupResult = await backupsService.cleanupOrphanedSchedules();

		expect(cleanupResult.deletedSchedules).toBe(0);

		const deletedSchedule = await db.query.backupSchedulesTable.findFirst({
			where: { id: orphanSchedule.id },
			columns: { id: true },
		});
		expect(deletedSchedule).toBeUndefined();

		const remainingHealthySchedule = await db.query.backupSchedulesTable.findFirst({
			where: { id: healthySchedule.id },
			columns: { id: true },
		});
		expect(remainingHealthySchedule?.id).toBe(healthySchedule.id);

		const orphanMirrors = await db.query.backupScheduleMirrorsTable.findMany({
			where: { scheduleId: orphanSchedule.id },
			columns: { id: true },
		});
		expect(orphanMirrors).toHaveLength(0);
	});
});
