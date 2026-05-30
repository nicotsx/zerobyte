import { beforeEach, expect, test } from "vitest";
import { db } from "~/server/db/db";
import { tasksTable } from "~/server/db/schema";
import { ensureTestOrganization, TEST_ORG_ID } from "~/test/helpers/organization";
import { generateBackupOutput } from "~/test/helpers/restic";
import { taskStore } from "../tasks.store";
import type { TaskInput, TaskProgress, TaskResult } from "../tasks.schemas";

const backupInput = (scheduleId = 1): TaskInput => ({
	kind: "backup",
	scheduleId,
	scheduleShortId: `schedule-${scheduleId}`,
	manual: false,
});

const backupProgress = (percentDone = 0.5): TaskProgress => ({
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

const backupResult = (): TaskResult => ({
	kind: "backup",
	exitCode: 0,
	result: JSON.parse(generateBackupOutput()),
	warningDetails: null,
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
