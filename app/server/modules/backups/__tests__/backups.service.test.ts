import waitForExpect from "wait-for-expect";
import { afterEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { backupsService } from "../backups.service";
import { createTestVolume } from "~/test/helpers/volume";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { createTestRepository } from "~/test/helpers/repository";
import { generateBackupOutput } from "~/test/helpers/restic";
import { faker } from "@faker-js/faker";
import * as spawnModule from "@zerobyte/core/node";
import type { SafeSpawnParams } from "@zerobyte/core/node";
import { db } from "~/server/db/db";
import { backupScheduleMirrorsTable, repositoriesTable, volumesTable } from "~/server/db/schema";
import { TEST_ORG_ID } from "~/test/helpers/organization";
import * as context from "~/server/core/request-context";
import { repositoriesService } from "~/server/modules/repositories/repositories.service";
import { agentManager } from "~/server/modules/agents/agents-manager";
import { createAgentBackupMocks } from "~/test/helpers/agent-mock";
import { getScheduleByIdOrShortId } from "../helpers/backup-schedule-lookups";
import { volumeService } from "~/server/modules/volumes/volume.service";
import { NotFoundError } from "http-errors-enhanced";

const setup = () => {
	const resticBackupMock = vi.fn((_: SafeSpawnParams) => Promise.resolve({ exitCode: 0, summary: "", error: "" }));
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
	vi.spyOn(repositoriesService, "refreshRepositoryStats").mockImplementation(refreshStatsMock);
	vi.spyOn(agentManager, "runBackup").mockImplementation(runBackupMock);
	vi.spyOn(agentManager, "cancelBackup").mockImplementation(cancelBackupMock);
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
		runBackupMock,
		cancelBackupMock,
		refreshStatsMock,
	};
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("execute backup", () => {
	test("should correctly set next backup time", async () => {
		// arrange
		const { resticBackupMock } = setup();
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
		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(updatedSchedule.nextBackupAt).not.toBeNull();

		const nextBackupAt = new Date(updatedSchedule.nextBackupAt ?? 0);
		const now = new Date();

		expect(nextBackupAt.getTime()).toBeGreaterThanOrEqual(now.getTime());
		expect(nextBackupAt.getTime() - now.getTime()).toBeLessThanOrEqual(5 * 60 * 1000);
	});

	test("should skip backup if schedule is disabled", async () => {
		// arrange
		const { resticBackupMock } = setup();
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
		const { resticBackupMock } = setup();
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
		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(updatedSchedule.lastBackupStatus).toBe("success");
		expect(updatedSchedule.lastBackupAt).not.toBeNull();
	});

	test("should keep next backup time empty for manual-only schedules after a manual run", async () => {
		// arrange
		const { resticBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			enabled: false,
			cronExpression: "",
		});

		resticBackupMock.mockImplementationOnce(() =>
			Promise.resolve({ exitCode: 0, summary: generateBackupOutput(), error: "" }),
		);

		// act
		await backupsService.executeBackup(schedule.id, true);

		// assert
		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(updatedSchedule.nextBackupAt).toBeNull();
	});

	test("should skip the backup if the previous one is still running", async () => {
		// arrange
		const { resticBackupMock } = setup();
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

		await waitForExpect(() => {
			expect(resticBackupMock).toHaveBeenCalledTimes(1);
		});

		await backupsService.executeBackup(schedule.id);

		// assert
		expect(resticBackupMock).toHaveBeenCalledTimes(1);
	});

	test("should set the backup status to failed if restic returns a 3 exit code", async () => {
		// arrange
		const { resticBackupMock } = setup();
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
		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(updatedSchedule.lastBackupStatus).toBe("warning");
	});

	test("should set the backup status to failed if restic returns a non zero exit code", async () => {
		// arrange
		const { resticBackupMock } = setup();
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
		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(updatedSchedule.lastBackupStatus).toBe("error");
	});
});

describe("getSchedulesToExecute", () => {
	test("should return schedules with NULL lastBackupStatus", async () => {
		// arrange
		setup();
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

describe("getScheduleByIdOrShortId", () => {
	test("should resolve a schedule by numeric id string", async () => {
		setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		const found = await getScheduleByIdOrShortId(String(schedule.id));

		expect(found.id).toBe(schedule.id);
		expect(found.shortId).toBe(schedule.shortId);
	});

	test("should resolve a schedule by short id", async () => {
		setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		const found = await getScheduleByIdOrShortId(schedule.shortId);

		expect(found.id).toBe(schedule.id);
		expect(found.shortId).toBe(schedule.shortId);
	});

	test("should not return schedules from another organization", async () => {
		setup();
		const otherOrgId = faker.string.uuid();
		const schedule = await createTestBackupSchedule({
			organizationId: otherOrgId,
		});

		await expect(getScheduleByIdOrShortId(schedule.shortId)).rejects.toThrow("Backup schedule not found");
		await expect(getScheduleByIdOrShortId(schedule.id)).rejects.toThrow("Backup schedule not found");
	});
});

describe("manual only schedules", () => {
	test("should create a manual-only schedule without a next backup time", async () => {
		setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();

		const schedule = await backupsService.createSchedule({
			name: "manual-only",
			volumeId: volume.shortId,
			repositoryId: repository.shortId,
			enabled: false,
			cronExpression: "",
			retryDelay: 0,
			maxRetries: 0,
		});

		expect(schedule.cronExpression).toBe("");
		expect(schedule.nextBackupAt).toBeNull();
		expect(schedule.enabled).toBe(false);
	});

	test("should reject enabled manual-only schedules on create", async () => {
		setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();

		await expect(
			backupsService.createSchedule({
				name: "manual-only",
				volumeId: volume.shortId,
				repositoryId: repository.shortId,
				enabled: true,
				cronExpression: "",
				retryDelay: 0,
				maxRetries: 0,
			}),
		).rejects.toThrow("Enabled schedules require a cron expression");
	});

	test("should clear the next backup time when updating a schedule to manual-only", async () => {
		setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			enabled: true,
			cronExpression: "0 0 * * *",
			nextBackupAt: faker.date.future().getTime(),
		});

		const updatedSchedule = await backupsService.updateSchedule(schedule.id, {
			repositoryId: repository.shortId,
			enabled: false,
			cronExpression: "",
			retryDelay: 0,
			maxRetries: 0,
		});

		expect(updatedSchedule.cronExpression).toBe("");
		expect(updatedSchedule.nextBackupAt).toBeNull();
		expect(updatedSchedule.enabled).toBe(false);
	});

	test("should reject enabled manual-only schedules on update", async () => {
		setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			enabled: false,
			cronExpression: "",
			nextBackupAt: null,
		});

		await expect(
			backupsService.updateSchedule(schedule.id, {
				repositoryId: repository.shortId,
				enabled: true,
				cronExpression: "",
				retryDelay: 0,
				maxRetries: 0,
			}),
		).rejects.toThrow("Enabled schedules require a cron expression");
	});
});

describe("schedule webhooks", () => {
	test("stores pre and post backup webhooks when creating a schedule", async () => {
		setup();
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

		const schedule = await backupsService.createSchedule({
			name: "with-webhooks",
			volumeId: volume.shortId,
			repositoryId: repository.shortId,
			enabled: true,
			cronExpression: "0 0 * * *",
			backupWebhooks,
			retryDelay: 15 * 60 * 1000,
			maxRetries: 2,
		});

		expect(schedule.backupWebhooks).toEqual(backupWebhooks);
	});

	test("clears backup webhooks when updating a schedule with null values", async () => {
		setup();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			repositoryId: repository.id,
			backupWebhooks: {
				pre: { url: "http://localhost:8080/stop" },
				post: { url: "http://localhost:8080/start" },
			},
		});

		const updated = await backupsService.updateSchedule(schedule.id, {
			repositoryId: repository.shortId,
			cronExpression: schedule.cronExpression,
			backupWebhooks: null,
			retryDelay: 15 * 60 * 1000,
			maxRetries: 2,
		});

		expect(updated.backupWebhooks).toBeNull();
	});
});

describe("listSchedules", () => {
	test("should ignore schedules with missing relations", async () => {
		setup();
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
		setup();
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
		setup();
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
