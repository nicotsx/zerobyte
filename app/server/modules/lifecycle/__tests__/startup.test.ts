import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Scheduler } from "~/server/core/scheduler";
import { serverEvents } from "~/server/core/events";
import { config } from "~/server/core/config";
import { db } from "~/server/db/db";
import { backupsService } from "~/server/modules/backups/backups.service";
import { repositoriesService } from "~/server/modules/repositories/repositories.service";
import { notificationsService } from "~/server/modules/notifications/notifications.service";
import { volumeService } from "~/server/modules/volumes/volume.service";
import * as provisioningModule from "~/server/modules/provisioning/provisioning";
import { taskStore } from "~/server/modules/tasks/tasks.store";
import { withContext } from "~/server/core/request-context";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { createTestRepository } from "~/test/helpers/repository";
import { createTestVolume } from "~/test/helpers/volume";
import { TEST_ORG_ID } from "~/test/helpers/organization";

const loadStartupModule = async () => {
	const moduleUrl = new URL("../startup.ts", import.meta.url);
	moduleUrl.searchParams.set("test", crypto.randomUUID());
	return import(moduleUrl.href);
};

let originalEnableLocalAgent: boolean;

beforeEach(() => {
	originalEnableLocalAgent = config.flags.enableLocalAgent;
	config.flags.enableLocalAgent = true;

	vi.spyOn(Scheduler, "start").mockResolvedValue();
	vi.spyOn(Scheduler, "clear").mockResolvedValue();
	vi.spyOn(Scheduler, "build").mockImplementation(() => ({ schedule: vi.fn() }));
	vi.spyOn(provisioningModule, "syncProvisionedResources").mockResolvedValue();
	vi.spyOn(backupsService, "cleanupOrphanedSchedules").mockResolvedValue({ deletedSchedules: 0 });
	vi.spyOn(volumeService, "updateVolume").mockResolvedValue(undefined as never);
	vi.spyOn(repositoriesService, "updateRepository").mockResolvedValue(undefined as never);
	vi.spyOn(notificationsService, "updateDestination").mockResolvedValue(undefined as never);
});

afterEach(() => {
	config.flags.enableLocalAgent = originalEnableLocalAgent;
	vi.restoreAllMocks();
});

test("marks active tasks stale and keeps stuck backup schedule recovery silent", async () => {
	const emitSpy = vi.spyOn(serverEvents, "emit");
	const notificationSpy = vi.spyOn(notificationsService, "sendBackupNotification").mockResolvedValue();
	const volume = await createTestVolume();
	const repository = await createTestRepository();
	const schedule = await createTestBackupSchedule({
		volumeId: volume.id,
		repositoryId: repository.id,
		lastBackupStatus: "in_progress",
		nextBackupAt: Date.now() + 24 * 60 * 60 * 1000,
	});
	const task = taskStore.create({
		id: "task-startup-active",
		organizationId: TEST_ORG_ID,
		resourceType: "backup_schedule",
		resourceId: String(schedule.id),
		targetAgentId: "local",
		input: {
			kind: "backup",
			scheduleId: schedule.id,
			scheduleShortId: schedule.shortId,
			manual: false,
		},
	});
	taskStore.markRunning(task.id);

	const { startup } = await loadStartupModule();

	await startup();

	const updatedTask = await db.query.tasksTable.findFirst({ where: { id: task.id } });
	const updatedSchedule = await db.query.backupSchedulesTable.findFirst({ where: { id: schedule.id } });
	expect(updatedTask?.status).toBe("stale");
	expect(updatedTask?.error).toBe("Zerobyte was restarted before this task completed");
	expect(updatedTask?.finishedAt).toEqual(expect.any(Number));
	expect(updatedSchedule?.lastBackupStatus).toBe("warning");
	expect(updatedSchedule?.lastBackupError).toBe("Zerobyte was restarted during the last scheduled backup");
	expect(updatedSchedule?.nextBackupAt).toBeNull();
	await withContext({ organizationId: TEST_ORG_ID }, async () => {
		expect(await backupsService.getSchedulesToExecute()).toContain(schedule.id);
	});
	expect(emitSpy).not.toHaveBeenCalledWith("backup:completed", expect.anything());
	expect(notificationSpy).not.toHaveBeenCalled();
});

test("makes existing restart warnings executable again on startup", async () => {
	const volume = await createTestVolume();
	const repository = await createTestRepository();
	const schedule = await createTestBackupSchedule({
		volumeId: volume.id,
		repositoryId: repository.id,
		lastBackupStatus: "warning",
		lastBackupError: "Zerobyte was restarted during the last scheduled backup",
		nextBackupAt: Date.now() + 24 * 60 * 60 * 1000,
	});

	const { startup } = await loadStartupModule();

	await startup();

	const updatedSchedule = await db.query.backupSchedulesTable.findFirst({ where: { id: schedule.id } });
	expect(updatedSchedule?.nextBackupAt).toBeNull();
	await withContext({ organizationId: TEST_ORG_ID }, async () => {
		expect(await backupsService.getSchedulesToExecute()).toContain(schedule.id);
	});
});
