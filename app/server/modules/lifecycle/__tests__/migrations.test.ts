import { expect, test } from "vitest";
import { db } from "~/server/db/db";
import { tasksTable } from "~/server/db/schema";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { createTestBackupScheduleMirror } from "~/test/helpers/backup-mirror";
import { createTestRepository } from "~/test/helpers/repository";
import { v00008 } from "../migrations/00008-backfill-mirror-sync-tasks";

test("backfills one terminal task for each legacy mirror status", async () => {
	const sourceRepository = await createTestRepository();
	const successfulRepository = await createTestRepository();
	const failedRepository = await createTestRepository();
	const interruptedRepository = await createTestRepository();
	const untouchedRepository = await createTestRepository();
	const schedule = await createTestBackupSchedule({ repositoryId: sourceRepository.id });

	await createTestBackupScheduleMirror(schedule.id, successfulRepository.id, {
		lastCopyAt: 100,
		lastCopyStatus: "success",
	});
	await createTestBackupScheduleMirror(schedule.id, failedRepository.id, {
		lastCopyAt: 200,
		lastCopyStatus: "error",
		lastCopyError: "Legacy copy failed",
	});
	await createTestBackupScheduleMirror(schedule.id, interruptedRepository.id, {
		lastCopyStatus: "in_progress",
	});
	await createTestBackupScheduleMirror(schedule.id, untouchedRepository.id);

	const firstResult = await v00008.execute();
	const secondResult = await v00008.execute();

	expect(firstResult.success).toBe(true);
	expect(secondResult.success).toBe(true);
	const tasks = await db.select().from(tasksTable);
	const mirrorTasks = tasks.filter((task) => task.kind === "mirrorSync");
	const tasksByRepository = new Map(mirrorTasks.map((task) => [task.operationKey, task]));

	expect(mirrorTasks).toHaveLength(3);
	expect(tasksByRepository.get(successfulRepository.shortId)).toMatchObject({
		status: "succeeded",
		finishedAt: 100,
		result: { kind: "mirrorSync" },
		error: null,
	});
	expect(tasksByRepository.get(failedRepository.shortId)).toMatchObject({
		status: "failed",
		finishedAt: 200,
		result: null,
		error: "Legacy copy failed",
	});
	expect(tasksByRepository.get(interruptedRepository.shortId)).toMatchObject({
		status: "stale",
		result: null,
		error: "Mirror synchronization was interrupted before task tracking was introduced",
	});
	expect(tasksByRepository.has(untouchedRepository.shortId)).toBe(false);
});
