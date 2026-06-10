import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { db } from "~/server/db/db";
import { tasksTable } from "~/server/db/schema";
import { ensureTestOrganization, TEST_ORG_ID } from "~/test/helpers/organization";
import { createTaskProgressBuffer } from "../progress-buffer";
import { taskStore } from "../tasks.store";
import type { TaskInput, TaskProgress } from "../tasks.schemas";

type BackupTaskInput = Extract<TaskInput, { kind: "backup" }>;
type BackupTaskProgress = Extract<TaskProgress, { kind: "backup" }>;

const backupInput = (scheduleId = 1): BackupTaskInput => ({
	kind: "backup",
	scheduleId,
	scheduleShortId: `schedule-${scheduleId}`,
	manual: false,
});

const backupProgress = (percentDone: number): BackupTaskProgress => ({
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

const createBackupTask = (id: string) =>
	taskStore.create({
		id,
		organizationId: TEST_ORG_ID,
		resourceType: "backup_schedule",
		resourceId: "1",
		targetAgentId: "local",
		input: backupInput(),
	});

const getPersistedProgress = async (taskId: string) => {
	const row = await db.query.tasksTable.findFirst({ where: { id: taskId } });
	const progress = row?.progress as BackupTaskProgress | null | undefined;

	return progress?.progress.percent_done ?? null;
};

beforeEach(async () => {
	await ensureTestOrganization();
	await db.delete(tasksTable);
});

afterEach(() => {
	vi.useRealTimers();
});

test("persists the first progress update immediately and buffers later updates", async () => {
	vi.useFakeTimers();
	const task = createBackupTask("progress-buffer-task");
	const buffer = createTaskProgressBuffer(task.id, { intervalMs: 1_000 });

	try {
		buffer.update(backupProgress(0.1));
		expect(await getPersistedProgress(task.id)).toBe(0.1);

		buffer.update(backupProgress(0.2));
		expect(await getPersistedProgress(task.id)).toBe(0.1);

		vi.advanceTimersByTime(999);
		expect(await getPersistedProgress(task.id)).toBe(0.1);

		vi.advanceTimersByTime(1);
		expect(await getPersistedProgress(task.id)).toBe(0.2);
	} finally {
		buffer.dispose();
	}
});
