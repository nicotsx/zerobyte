import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Scheduler } from "~/server/core/scheduler";
import { db } from "~/server/db/db";
import { volumesTable } from "~/server/db/schema";
import { backupsService } from "~/server/modules/backups/backups.service";
import { repositoriesService } from "~/server/modules/repositories/repositories.service";
import { notificationsService } from "~/server/modules/notifications/notifications.service";
import { volumeService } from "~/server/modules/volumes/volume.service";
import * as provisioningModule from "~/server/modules/provisioning/provisioning";
import { RESTART_TASK_ERROR, taskStore } from "~/server/modules/tasks/tasks.store";
import { withContext } from "~/server/core/request-context";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { createTestRepository } from "~/test/helpers/repository";
import { createTestVolume } from "~/test/helpers/volume";
import { TEST_ORG_ID } from "~/test/helpers/organization";
import { backupSchedulesTable } from "~/server/db/schema";
import { eq } from "drizzle-orm";

const loadStartupModule = async () => {
	const moduleUrl = new URL("../startup.ts", import.meta.url);
	moduleUrl.searchParams.set("test", crypto.randomUUID());
	return import(moduleUrl.href);
};

beforeEach(async () => {
	await db.delete(volumesTable);
	vi.spyOn(Scheduler, "start").mockResolvedValue();
	vi.spyOn(Scheduler, "clear").mockResolvedValue();
	vi.spyOn(Scheduler, "build").mockImplementation(() => ({ schedule: vi.fn() }));
	vi.spyOn(provisioningModule, "syncProvisionedResources").mockResolvedValue();
	vi.spyOn(backupsService, "cleanupOrphanedSchedules").mockResolvedValue({ deletedSchedules: 0 });
	vi.spyOn(volumeService, "updateVolume").mockResolvedValue(undefined as never);
	vi.spyOn(volumeService, "mountVolume").mockResolvedValue({ status: "mounted", error: undefined });
	vi.spyOn(repositoriesService, "updateRepository").mockResolvedValue(undefined as never);
	vi.spyOn(notificationsService, "updateDestination").mockResolvedValue(undefined as never);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

test("marks active scheduled backup tasks stale and makes them executable again", async () => {
	const notificationSpy = vi.spyOn(notificationsService, "sendBackupNotification").mockResolvedValue();
	const volume = await createTestVolume();
	const repository = await createTestRepository();
	const nextBackupAt = Date.now() + 24 * 60 * 60 * 1000;
	const schedule = await createTestBackupSchedule({
		volumeId: volume.id,
		repositoryId: repository.id,
		lastBackupStatus: "in_progress",
		nextBackupAt,
	});
	const task = taskStore.create({
		id: "task-startup-active",
		organizationId: TEST_ORG_ID,
		resourceType: "backup_schedule",
		resourceId: schedule.shortId,
		targetDisplayName: schedule.name,
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
	expect(updatedTask?.error).toBe(RESTART_TASK_ERROR);
	expect(updatedTask?.finishedAt).toEqual(expect.any(Number));
	expect(updatedSchedule?.lastBackupStatus).toBe("warning");
	expect(updatedSchedule?.lastBackupError).toBe("Zerobyte was restarted during the last scheduled backup");
	expect(updatedSchedule?.nextBackupAt).toBeNull();
	await withContext({ organizationId: TEST_ORG_ID }, async () => {
		expect(await backupsService.getSchedulesToExecute()).toContain(schedule.id);
	});
	expect(notificationSpy).not.toHaveBeenCalled();
});

test("marks active manual backup tasks stale without making the schedule executable", async () => {
	const volume = await createTestVolume();
	const repository = await createTestRepository();
	const nextBackupAt = Date.now() + 24 * 60 * 60 * 1000;
	const schedule = await createTestBackupSchedule({
		volumeId: volume.id,
		repositoryId: repository.id,
		lastBackupStatus: "in_progress",
		nextBackupAt,
	});
	const task = taskStore.create({
		id: "task-startup-manual",
		organizationId: TEST_ORG_ID,
		resourceType: "backup_schedule",
		resourceId: schedule.shortId,
		targetDisplayName: schedule.name,
		targetAgentId: "local",
		input: {
			kind: "backup",
			scheduleId: schedule.id,
			scheduleShortId: schedule.shortId,
			manual: true,
		},
	});
	taskStore.markRunning(task.id);

	const { startup } = await loadStartupModule();

	await startup();

	const updatedSchedule = await db.query.backupSchedulesTable.findFirst({ where: { id: schedule.id } });
	expect(updatedSchedule?.lastBackupStatus).toBe("warning");
	expect(updatedSchedule?.lastBackupError).toBe("Zerobyte was restarted during the last scheduled backup");
	expect(updatedSchedule?.nextBackupAt).toBe(nextBackupAt);
});

test("does not immediately retry cancellation-requested scheduled backups", async () => {
	const volume = await createTestVolume();
	const repository = await createTestRepository();
	const nextBackupAt = Date.now() + 24 * 60 * 60 * 1000;
	const schedule = await createTestBackupSchedule({
		volumeId: volume.id,
		repositoryId: repository.id,
		lastBackupStatus: "in_progress",
		nextBackupAt,
	});
	const task = taskStore.create({
		id: "task-startup-cancelling",
		organizationId: TEST_ORG_ID,
		resourceType: "backup_schedule",
		resourceId: schedule.shortId,
		targetDisplayName: schedule.name,
		targetAgentId: "local",
		input: {
			kind: "backup",
			scheduleId: schedule.id,
			scheduleShortId: schedule.shortId,
			manual: false,
		},
	});
	taskStore.markRunning(task.id);
	taskStore.requestCancel(task.id);

	const { startup } = await loadStartupModule();

	await startup();

	const updatedSchedule = await db.query.backupSchedulesTable.findFirst({ where: { id: schedule.id } });
	expect(updatedSchedule?.lastBackupStatus).toBe("warning");
	expect(updatedSchedule?.lastBackupError).toBe("Zerobyte was restarted during the last scheduled backup");
	expect(updatedSchedule?.nextBackupAt).toBe(nextBackupAt);
});

test("makes in-progress scheduled backups without task rows executable again", async () => {
	const volume = await createTestVolume();
	const repository = await createTestRepository();
	const nextBackupAt = Date.now() + 24 * 60 * 60 * 1000;
	const schedule = await createTestBackupSchedule({
		volumeId: volume.id,
		repositoryId: repository.id,
		lastBackupStatus: "in_progress",
		nextBackupAt,
	});

	const { startup } = await loadStartupModule();

	await startup();

	const updatedSchedule = await db.query.backupSchedulesTable.findFirst({ where: { id: schedule.id } });
	expect(updatedSchedule?.lastBackupStatus).toBe("warning");
	expect(updatedSchedule?.lastBackupError).toBe("Zerobyte was restarted during the last scheduled backup");
	expect(updatedSchedule?.nextBackupAt).toBeNull();
});

test("ignores previously stale scheduled tasks when the current interrupted task is manual", async () => {
	const volume = await createTestVolume();
	const repository = await createTestRepository();
	const nextBackupAt = Date.now() + 24 * 60 * 60 * 1000;
	const schedule = await createTestBackupSchedule({
		volumeId: volume.id,
		repositoryId: repository.id,
		lastBackupStatus: "in_progress",
		nextBackupAt,
	});
	taskStore.create({
		id: "task-a-old-scheduled",
		organizationId: TEST_ORG_ID,
		resourceType: "backup_schedule",
		resourceId: schedule.shortId,
		targetDisplayName: schedule.name,
		targetAgentId: "local",
		input: {
			kind: "backup",
			scheduleId: schedule.id,
			scheduleShortId: schedule.shortId,
			manual: false,
		},
	});
	taskStore.markActiveStale({
		organizationId: TEST_ORG_ID,
		kind: "backup",
		resourceType: "backup_schedule",
		resourceId: schedule.shortId,
		error: RESTART_TASK_ERROR,
	});
	const latestTask = taskStore.create({
		id: "task-z-new-manual",
		organizationId: TEST_ORG_ID,
		resourceType: "backup_schedule",
		resourceId: schedule.shortId,
		targetDisplayName: schedule.name,
		targetAgentId: "local",
		input: {
			kind: "backup",
			scheduleId: schedule.id,
			scheduleShortId: schedule.shortId,
			manual: true,
		},
	});
	taskStore.markRunning(latestTask.id);

	const { startup } = await loadStartupModule();

	await startup();

	const updatedSchedule = await db.query.backupSchedulesTable.findFirst({ where: { id: schedule.id } });
	expect(updatedSchedule?.lastBackupStatus).toBe("warning");
	expect(updatedSchedule?.lastBackupError).toBe("Zerobyte was restarted during the last scheduled backup");
	expect(updatedSchedule?.nextBackupAt).toBe(nextBackupAt);
});

test("does not use previously stale scheduled tasks to retry immediately", async () => {
	const volume = await createTestVolume();
	const repository = await createTestRepository();
	const nextBackupAt = Date.now() + 24 * 60 * 60 * 1000;
	const schedule = await createTestBackupSchedule({
		volumeId: volume.id,
		repositoryId: repository.id,
		lastBackupStatus: "warning",
		lastBackupError: "Previous interrupted scheduled backup warning",
		nextBackupAt,
	});
	taskStore.create({
		id: "task-existing-restart-warning",
		organizationId: TEST_ORG_ID,
		resourceType: "backup_schedule",
		resourceId: schedule.shortId,
		targetDisplayName: schedule.name,
		targetAgentId: "local",
		input: {
			kind: "backup",
			scheduleId: schedule.id,
			scheduleShortId: schedule.shortId,
			manual: false,
		},
	});
	taskStore.markActiveStale({
		organizationId: TEST_ORG_ID,
		kind: "backup",
		resourceType: "backup_schedule",
		resourceId: schedule.shortId,
		error: RESTART_TASK_ERROR,
	});

	const { startup } = await loadStartupModule();

	await startup();

	const updatedSchedule = await db.query.backupSchedulesTable.findFirst({ where: { id: schedule.id } });
	expect(updatedSchedule?.nextBackupAt).toBe(nextBackupAt);
});

test("does not stale tasks or schedules created after bootstrap begins", async () => {
	const bootstrapStartedAt = 1_700_000_000_000;
	vi.useFakeTimers({ now: bootstrapStartedAt - 1 });
	const volume = await createTestVolume();
	const repository = await createTestRepository();
	const oldSchedule = await createTestBackupSchedule({
		volumeId: volume.id,
		repositoryId: repository.id,
		lastBackupStatus: "in_progress",
	});
	db.update(backupSchedulesTable)
		.set({ updatedAt: bootstrapStartedAt - 1 })
		.where(eq(backupSchedulesTable.id, oldSchedule.id))
		.run();
	const oldTask = taskStore.create({
		id: "task-before-bootstrap",
		organizationId: TEST_ORG_ID,
		resourceType: "backup_schedule",
		resourceId: oldSchedule.shortId,
		targetDisplayName: oldSchedule.name,
		input: {
			kind: "backup",
			scheduleId: oldSchedule.id,
			scheduleShortId: oldSchedule.shortId,
			manual: true,
		},
	});
	taskStore.markRunning(oldTask.id);

	vi.setSystemTime(bootstrapStartedAt);
	const currentSchedule = await createTestBackupSchedule({
		volumeId: volume.id,
		repositoryId: repository.id,
		lastBackupStatus: "in_progress",
	});
	db.update(backupSchedulesTable)
		.set({ updatedAt: bootstrapStartedAt })
		.where(eq(backupSchedulesTable.id, currentSchedule.id))
		.run();
	const currentTask = taskStore.create({
		id: "task-during-bootstrap",
		organizationId: TEST_ORG_ID,
		resourceType: "backup_schedule",
		resourceId: currentSchedule.shortId,
		targetDisplayName: currentSchedule.name,
		input: {
			kind: "backup",
			scheduleId: currentSchedule.id,
			scheduleShortId: currentSchedule.shortId,
			manual: true,
		},
	});
	taskStore.markRunning(currentTask.id);

	const { startup } = await loadStartupModule();
	await startup(bootstrapStartedAt);

	const staleTask = await db.query.tasksTable.findFirst({ where: { id: oldTask.id } });
	const preservedTask = await db.query.tasksTable.findFirst({ where: { id: currentTask.id } });
	const staleSchedule = await db.query.backupSchedulesTable.findFirst({ where: { id: oldSchedule.id } });
	const preservedSchedule = await db.query.backupSchedulesTable.findFirst({ where: { id: currentSchedule.id } });
	expect(staleTask?.status).toBe("stale");
	expect(staleSchedule?.lastBackupStatus).toBe("warning");
	expect(preservedTask?.status).toBe("running");
	expect(preservedSchedule?.lastBackupStatus).toBe("in_progress");
});

test("remounts saved local managed volumes without retrying other source states", async () => {
	const mounted = await createTestVolume({ name: "Startup mounted", autoRemount: false, status: "mounted" });
	const retryableError = await createTestVolume({
		name: "Startup retryable error",
		autoRemount: true,
		status: "error",
	});
	const nonRetryableError = await createTestVolume({
		name: "Startup non-retryable error",
		autoRemount: false,
		status: "error",
	});
	const unmounted = await createTestVolume({ name: "Startup unmounted", status: "unmounted" });
	const remoteManaged = await createTestVolume({
		name: "Startup remote managed",
		agentId: "remote-agent",
		status: "mounted",
	});
	const remoteFilesystem = await createTestVolume({
		name: "Startup remote filesystem",
		agentId: "remote-agent",
		sourceKind: "agent-filesystem",
		config: null,
		type: null,
		trustedRootId: "photos",
		relativePath: "",
		autoRemount: false,
		status: "mounted",
	});
	const localFilesystem = await createTestVolume({
		name: "Startup local filesystem",
		sourceKind: "agent-filesystem",
		config: null,
		type: null,
		trustedRootId: "photos",
		relativePath: "",
		autoRemount: false,
		status: "mounted",
	});
	const mountVolume = vi.mocked(volumeService.mountVolume);
	mountVolume.mockRejectedValueOnce(new Error("mount failed"));

	const { startup } = await loadStartupModule();

	await startup();

	expect(mountVolume).toHaveBeenCalledTimes(2);
	expect(mountVolume).toHaveBeenCalledWith(mounted.shortId);
	expect(mountVolume).toHaveBeenCalledWith(retryableError.shortId);
	expect(mountVolume).not.toHaveBeenCalledWith(nonRetryableError.shortId);
	expect(mountVolume).not.toHaveBeenCalledWith(unmounted.shortId);
	expect(mountVolume).not.toHaveBeenCalledWith(remoteManaged.shortId);
	expect(mountVolume).not.toHaveBeenCalledWith(remoteFilesystem.shortId);
	expect(mountVolume).not.toHaveBeenCalledWith(localFilesystem.shortId);
});
