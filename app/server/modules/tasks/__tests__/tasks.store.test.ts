import { beforeEach, expect, test } from "vitest";
import { db } from "~/server/db/db";
import { tasksTable } from "~/server/db/schema";
import { ensureTestOrganization, TEST_ORG_ID } from "~/test/helpers/organization";
import { generateBackupOutput } from "~/test/helpers/restic";
import { taskStore } from "../tasks.store";
import type { TaskInput, TaskProgress, TaskResult } from "~/schemas/tasks";

type BackupTaskInput = Extract<TaskInput, { kind: "backup" }>;
type BackupTaskProgress = Extract<TaskProgress, { kind: "backup" }>;
type BackupTaskResult = Extract<TaskResult, { kind: "backup" }>;
type DeleteSnapshotsTaskInput = Extract<TaskInput, { kind: "deleteSnapshots" }>;
type DeleteSnapshotsTaskResult = Extract<TaskResult, { kind: "deleteSnapshots" }>;

const backupInput = (scheduleId = 1): BackupTaskInput => ({
	kind: "backup",
	scheduleId,
	scheduleShortId: `schedule-${scheduleId}`,
	manual: false,
});

const backupProgress = (percentDone = 0.5): BackupTaskProgress => ({
	kind: "backup",
	progress: {
		message_type: "status",
		seconds_elapsed: 1,
		seconds_remaining: 1,
		percent_done: percentDone,
		total_files: 10,
		files_done: 5,
		total_bytes: 100,
		bytes_done: 50,
		current_files: [],
	},
});

const backupResult = (): BackupTaskResult => ({
	kind: "backup",
	exitCode: 0,
	result: JSON.parse(generateBackupOutput()),
	warningDetails: null,
});

const deleteSnapshotsInput = (snapshotIds = ["snapshot-1"]): DeleteSnapshotsTaskInput => ({
	kind: "deleteSnapshots",
	repositoryId: "repo-short",
	snapshotIds,
});

const deleteSnapshotsResult = (deletedSnapshotIds = ["snapshot-1"]): DeleteSnapshotsTaskResult => ({
	kind: "deleteSnapshots",
	deletedSnapshotIds,
});

const createBackupTask = (overrides: Partial<Parameters<typeof taskStore.create>[0]> = {}) =>
	taskStore.create({
		organizationId: TEST_ORG_ID,
		resourceType: "backup_schedule",
		resourceId: "1",
		targetAgentId: "local",
		input: backupInput(),
		...overrides,
	});

const createRestoreTask = (overrides: Partial<Parameters<typeof taskStore.create>[0]> = {}) =>
	taskStore.create({
		organizationId: TEST_ORG_ID,
		resourceType: "repository",
		resourceId: "repo-short",
		targetAgentId: "local",
		input: { kind: "restore", repositoryId: "repo-short", snapshotId: "snapshot-1", target: "/tmp/restore" },
		...overrides,
	});

const createDeleteSnapshotsTask = (overrides: Partial<Parameters<typeof taskStore.create>[0]> = {}) =>
	taskStore.create({
		organizationId: TEST_ORG_ID,
		resourceType: "repository",
		resourceId: "repo-short",
		input: deleteSnapshotsInput(),
		...overrides,
	});

beforeEach(async () => {
	await ensureTestOrganization();
	await db.delete(tasksTable);
});

test("creates queued backup tasks with parsed input and durable metadata only", () => {
	const task = createBackupTask({
		id: "task-create",
		input: { ...backupInput(12), manual: true },
		resourceId: "12",
	});

	expect(task).toMatchObject({
		id: "task-create",
		organizationId: TEST_ORG_ID,
		kind: "backup",
		status: "queued",
		resourceType: "backup_schedule",
		resourceId: "12",
		targetAgentId: "local",
		input: {
			kind: "backup",
			scheduleId: 12,
			scheduleShortId: "schedule-12",
			manual: true,
		},
		progress: null,
		result: null,
		error: null,
		cancellationRequested: false,
		startedAt: null,
		finishedAt: null,
	});
	expect(Object.keys(task.input)).toEqual(["kind", "scheduleId", "scheduleShortId", "manual"]);
});

test("moves an active task through running, progress, cancellation request, and success", () => {
	const task = createBackupTask({ id: "task-success" });

	const running = taskStore.markRunning(task.id);
	expect(running.status).toBe("running");
	expect(running.startedAt).toEqual(expect.any(Number));

	const progressed = taskStore.updateProgress(task.id, backupProgress(0.7));
	expect(progressed.progress?.progress.percent_done).toBe(0.7);

	const cancelling = taskStore.requestCancel(task.id);
	expect(cancelling.status).toBe("cancelling");
	expect(cancelling.cancellationRequested).toBe(true);

	const completed = taskStore.complete(task.id, backupResult());
	expect(completed.status).toBe("succeeded");
	expect(completed.result?.kind).toBe("backup");
	if (completed.result?.kind !== "backup") {
		throw new Error("Expected backup result");
	}
	expect(completed.result?.result?.snapshot_id).toBe("abcd1234");
	expect(completed.finishedAt).toEqual(expect.any(Number));
	expect(completed.cancellationRequested).toBe(true);
});

test("records failed and cancelled terminal task states", () => {
	const failedTask = createBackupTask({ id: "task-failed", resourceId: "failed" });
	const failed = taskStore.fail(failedTask.id, "restic failed");
	expect(failed.status).toBe("failed");
	expect(failed.error).toBe("restic failed");
	expect(failed.finishedAt).toEqual(expect.any(Number));

	const cancelledTask = createBackupTask({ id: "task-cancelled", resourceId: "cancelled" });
	taskStore.requestCancel(cancelledTask.id);
	const cancelled = taskStore.cancel(cancelledTask.id, "Backup was stopped by the user");
	expect(cancelled.status).toBe("cancelled");
	expect(cancelled.error).toBe("Backup was stopped by the user");
	expect(cancelled.cancellationRequested).toBe(true);
});

test("moves restore tasks through progress and success", () => {
	const task = createRestoreTask({ id: "restore-task" });

	const running = taskStore.markRunning(task.id);
	expect(running.kind).toBe("restore");
	expect(running.input).toMatchObject({ kind: "restore", snapshotId: "snapshot-1" });

	const progressed = taskStore.updateProgress(task.id, {
		kind: "restore",
		progress: {
			message_type: "status",
			seconds_elapsed: 2,
			percent_done: 0.25,
			total_files: 4,
			files_restored: 1,
			total_bytes: 400,
			bytes_restored: 100,
		},
	});
	expect(progressed.progress?.progress.percent_done).toBe(0.25);

	const completed = taskStore.complete(task.id, {
		kind: "restore",
		result: {
			message_type: "summary",
			total_files: 4,
			files_restored: 4,
			files_skipped: 0,
		},
	});
	expect(completed.status).toBe("succeeded");
	expect(completed.result?.kind).toBe("restore");
	if (completed.result?.kind !== "restore") {
		throw new Error("Expected restore result");
	}
	expect(completed.result?.result.files_restored).toBe(4);
});

test("moves delete snapshot tasks through running and success", () => {
	const task = createDeleteSnapshotsTask({
		id: "delete-snapshots-task",
		input: deleteSnapshotsInput(["snapshot-1", "snapshot-2"]),
	});

	const running = taskStore.markRunning(task.id);
	expect(running.kind).toBe("deleteSnapshots");
	expect(running.input).toMatchObject({
		kind: "deleteSnapshots",
		repositoryId: "repo-short",
		snapshotIds: ["snapshot-1", "snapshot-2"],
	});

	const completed = taskStore.complete(task.id, deleteSnapshotsResult(["snapshot-1", "snapshot-2"]));
	expect(completed.status).toBe("succeeded");
	expect(completed.result?.kind).toBe("deleteSnapshots");
	if (completed.result?.kind !== "deleteSnapshots") {
		throw new Error("Expected deleteSnapshots result");
	}
	expect(completed.result.deletedSnapshotIds).toEqual(["snapshot-1", "snapshot-2"]);
});

test("finds the newest active task for a resource and marks only matching active tasks stale", async () => {
	createBackupTask({ id: "task-a-old", resourceId: "shared" });
	const newest = createBackupTask({ id: "task-z-new", resourceId: "shared" });
	const otherResource = createBackupTask({ id: "task-other", resourceId: "other" });
	const terminal = taskStore.complete(
		createBackupTask({ id: "task-terminal", resourceId: "shared" }).id,
		backupResult(),
	);

	const active = taskStore.findActiveByResource({
		organizationId: TEST_ORG_ID,
		kind: "backup",
		resourceType: "backup_schedule",
		resourceId: "shared",
	});
	expect(active?.id).toBe(newest.id);

	const staleTasks = taskStore.markActiveStale({
		organizationId: TEST_ORG_ID,
		kind: "backup",
		resourceType: "backup_schedule",
		resourceId: "shared",
		error: "process restarted",
	});
	expect(staleTasks.map((task) => task.id).sort()).toEqual(["task-a-old", "task-z-new"]);

	const other = await db.query.tasksTable.findFirst({ where: { id: otherResource.id } });
	const completed = await db.query.tasksTable.findFirst({ where: { id: terminal.id } });
	expect(other?.status).toBe("queued");
	expect(completed?.status).toBe("succeeded");
});

test("lists active tasks with optional filters", () => {
	const backupTask = createBackupTask({ id: "task-list-backup" });
	const deleteSnapshotsTask = createDeleteSnapshotsTask({ id: "task-list-delete-snapshots" });
	const completedTask = createDeleteSnapshotsTask({ id: "task-list-completed-delete-snapshots" });
	taskStore.complete(completedTask.id, deleteSnapshotsResult());

	const activeTasks = taskStore.listActive({ organizationId: TEST_ORG_ID });
	const activeDeleteTasks = taskStore.listActive({ organizationId: TEST_ORG_ID, kind: "deleteSnapshots" });

	expect(activeTasks.map((task) => task.id).sort()).toEqual([backupTask.id, deleteSnapshotsTask.id].sort());
	expect(activeDeleteTasks.map((task) => task.id)).toEqual([deleteSnapshotsTask.id]);
});

test("parses task JSON on reads and rejects invalid persisted shapes", () => {
	db.insert(tasksTable)
		.values({
			id: "task-invalid-json",
			organizationId: TEST_ORG_ID,
			kind: "backup",
			status: "queued",
			resourceType: "backup_schedule",
			resourceId: "invalid",
			input: {
				kind: "backup",
				scheduleId: "not-a-number",
				scheduleShortId: "schedule-invalid",
				manual: false,
			},
			cancellationRequested: false,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		})
		.run();

	expect(() =>
		taskStore.findActiveByResource({
			organizationId: TEST_ORG_ID,
			kind: "backup",
			resourceType: "backup_schedule",
			resourceId: "invalid",
		}),
	).toThrow();
});

test("terminal updates do not mutate unrelated task rows", async () => {
	const task = createBackupTask({ id: "task-target", resourceId: "target" });
	const unrelated = createBackupTask({ id: "task-unrelated", resourceId: "unrelated" });

	taskStore.complete(task.id, backupResult());

	const targetRow = await db.query.tasksTable.findFirst({ where: { id: task.id } });
	const unrelatedRow = await db.query.tasksTable.findFirst({ where: { id: unrelated.id } });

	expect(targetRow?.status).toBe("succeeded");
	expect(unrelatedRow?.status).toBe("queued");
	expect(unrelatedRow?.finishedAt).toBeNull();
});
