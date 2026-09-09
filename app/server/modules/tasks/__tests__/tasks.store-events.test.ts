import { beforeEach, expect, test, vi } from "vitest";
import { db } from "~/server/db/db";
import { tasksTable } from "~/server/db/schema";
import { ensureTestOrganization, TEST_ORG_ID } from "~/test/helpers/organization";

beforeEach(async () => {
	await ensureTestOrganization();
	await db.delete(tasksTable);
});

test("delivers task changes across separate module instances", async () => {
	const publisherStore = (await import("../tasks.store")).taskStore;
	const task = publisherStore.create({
		id: "cross-module-task",
		organizationId: TEST_ORG_ID,
		resourceType: "backup_schedule",
		resourceId: "backup-1",
		targetDisplayName: "Backup",
		input: {
			kind: "backup",
			scheduleId: 1,
			scheduleShortId: "backup-1",
			manual: false,
		},
	});

	vi.resetModules();
	const subscriberStore = (await import("../tasks.store")).taskStore;
	const changedTasks: string[] = [];
	const unsubscribe = subscriberStore.subscribeToAllChanges({ organizationId: TEST_ORG_ID, kind: "backup" }, (task) =>
		changedTasks.push(task.id),
	);

	try {
		publisherStore.markRunning(task.id);

		expect(changedTasks).toContain(task.id);
	} finally {
		unsubscribe();
	}
});
