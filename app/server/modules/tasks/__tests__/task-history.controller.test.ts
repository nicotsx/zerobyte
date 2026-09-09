import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { ServerEventPayloadMap } from "~/schemas/server-events";
import { TASK_PERSISTENCE_FORMAT_VERSION } from "~/schemas/tasks";
import { createApp } from "~/server/app";
import { serverEvents } from "~/server/core/events";
import { db } from "~/server/db/db";
import { tasksTable } from "~/server/db/schema";
import { createTestSession } from "~/test/helpers/auth";
import { taskStore } from "../tasks.store";

const app = createApp();

let session: Awaited<ReturnType<typeof createTestSession>>;

const createRepositoryTask = (
	organizationId: string,
	id: string,
	kind: "deleteSnapshots" | "doctor" = "deleteSnapshots",
	repositoryId = "repo-missing",
) => {
	return taskStore.create({
		id,
		organizationId,
		resourceType: "repository",
		resourceId: repositoryId,
		targetDisplayName: `Repository ${repositoryId}`,
		input:
			kind === "doctor"
				? { kind: "doctor", repositoryId }
				: { kind: "deleteSnapshots", repositoryId, snapshotIds: ["snapshot-1"] },
	});
};

const createMirrorStatusTask = (organizationId: string, id: string) => {
	return taskStore.create({
		id,
		organizationId,
		resourceType: "backup_schedule",
		resourceId: "schedule-short",
		operationKey: "source-repository:mirror-repository",
		targetDisplayName: "Backup schedule",
		input: {
			kind: "mirrorStatus",
			scheduleId: 1,
			scheduleShortId: "schedule-short",
			sourceRepositoryId: "source-repository",
			mirrorRepositoryId: "mirror-repository",
		},
	});
};

const setCreatedAt = (taskId: string, createdAt: number) => {
	db.update(tasksTable).set({ createdAt }).where(eq(tasksTable.id, taskId)).run();
};

type TaskCorruption = "nullTarget" | "unknownResource" | "legacyOutcome" | "unknownKind" | "malformedPayload";

const legacyTaskCorruptions: TaskCorruption[] = [
	"nullTarget",
	"unknownResource",
	"legacyOutcome",
	"unknownKind",
	"malformedPayload",
];

const corruptTask = (taskId: string, corruption: TaskCorruption) => {
	switch (corruption) {
		case "nullTarget":
			db.update(tasksTable).set({ targetDisplayName: null }).where(eq(tasksTable.id, taskId)).run();
			return;
		case "unknownResource":
			db.update(tasksTable).set({ resourceType: "future_resource" }).where(eq(tasksTable.id, taskId)).run();
			return;
		case "legacyOutcome":
			db.update(tasksTable)
				.set({ outcome: sql`'running'` })
				.where(eq(tasksTable.id, taskId))
				.run();
			return;
		case "unknownKind":
			db.update(tasksTable)
				.set({
					kind: "futureTask",
					input: { kind: "futureTask" },
				})
				.where(eq(tasksTable.id, taskId))
				.run();
			return;
		case "malformedPayload":
			db.update(tasksTable)
				.set({
					kind: "backup",
					input: { kind: "backup" },
				})
				.where(eq(tasksTable.id, taskId))
				.run();
			return;
	}
};

beforeAll(async () => {
	session = await createTestSession();
});

beforeEach(async () => {
	await db.delete(tasksTable);
});

describe("task history", () => {
	test("hides mirror status lookups from activity, counts, filters, and history events", async () => {
		const changes: ServerEventPayloadMap["task:history-changed"][] = [];
		const recordChange = (event: ServerEventPayloadMap["task:history-changed"]) => changes.push(event);
		serverEvents.on("task:history-changed", recordChange);
		const hiddenTask = createMirrorStatusTask(session.organizationId, "hidden-mirror-status");
		const visibleTask = createRepositoryTask(session.organizationId, "visible-task");
		taskStore.complete(hiddenTask.id, {
			kind: "mirrorStatus",
			sourceCount: 1,
			mirrorCount: 0,
			missingSnapshots: [{ short_id: "snapshot-1", time: "2025-01-01T00:00:00Z", size: 1 }],
		});

		try {
			const response = await app.request("/api/v1/tasks/history", { headers: session.headers });
			const history = await response.json();
			const filterResponse = await app.request("/api/v1/tasks/history?kind=mirrorStatus", {
				headers: session.headers,
			});

			expect(response.status).toBe(200);
			expect(history.items.map((item: { id: string }) => item.id)).toEqual([visibleTask.id]);
			expect(history.totalItems).toBe(1);
			expect(history.totalPages).toBe(1);
			expect(filterResponse.status).toBe(400);
			expect(changes.some((change) => change.item.id === hiddenTask.id)).toBe(false);
		} finally {
			serverEvents.off("task:history-changed", recordChange);
		}
	});

	test("presents retention tasks against their backup schedule", async () => {
		const task = taskStore.create({
			id: "retention-task",
			organizationId: session.organizationId,
			resourceType: "backup_schedule",
			resourceId: "daily-backup",
			targetDisplayName: "Daily backup",
			operationKey: "archive-repository",
			input: {
				kind: "forget",
				scheduleId: 42,
				scheduleShortId: "daily-backup",
				repositoryId: "archive-repository",
				retentionPolicy: { keepDaily: 7 },
				trigger: "postBackup",
			},
		});
		taskStore.markRunning(task.id);
		taskStore.complete(task.id, { kind: "forget" });

		const response = await app.request("/api/v1/tasks/history?kind=forget", {
			headers: session.headers,
		});

		expect(response.status).toBe(200);
		const history = await response.json();
		expect(history.items).toEqual([
			expect.objectContaining({
				id: task.id,
				kind: "forget",
				outcome: "success",
				target: {
					kind: "backupSchedule",
					label: "Daily backup",
					secondary: null,
					scheduleShortId: "daily-backup",
				},
			}),
		]);
	});

	test("presents retention tasks persisted before policies were stored in task input", async () => {
		const task = taskStore.create({
			id: "legacy-retention-task",
			organizationId: session.organizationId,
			resourceType: "backup_schedule",
			resourceId: "daily-backup",
			targetDisplayName: "Daily backup",
			operationKey: "archive-repository",
			input: {
				kind: "forget",
				scheduleId: 42,
				scheduleShortId: "daily-backup",
				repositoryId: "archive-repository",
				retentionPolicy: { keepDaily: 7 },
				trigger: "postBackup",
			},
		});
		taskStore.markRunning(task.id);
		taskStore.complete(task.id, { kind: "forget" });
		db.update(tasksTable)
			.set({
				input: {
					kind: "forget",
					scheduleId: 42,
					scheduleShortId: "daily-backup",
					repositoryId: "archive-repository",
					trigger: "postBackup",
				},
			})
			.where(eq(tasksTable.id, task.id))
			.run();

		const response = await app.request("/api/v1/tasks/history?kind=forget", {
			headers: session.headers,
		});

		expect(response.status).toBe(200);
		const history = await response.json();
		expect(history.items).toEqual([
			expect.objectContaining({
				id: task.id,
				kind: "forget",
				target: expect.objectContaining({
					kind: "backupSchedule",
					scheduleShortId: "daily-backup",
				}),
			}),
		]);
	});

	test("isolates history by organization without changing the active task endpoint", async () => {
		const otherSession = await createTestSession();
		const visible = createRepositoryTask(session.organizationId, "visible-task");
		createRepositoryTask(otherSession.organizationId, "hidden-task");

		const historyResponse = await app.request("/api/v1/tasks/history", {
			headers: session.headers,
		});
		const activeResponse = await app.request("/api/v1/tasks", { headers: session.headers });

		expect(historyResponse.status).toBe(200);
		const history = await historyResponse.json();
		expect(history.organizationId).toBe(session.organizationId);
		expect(history.items.map((item: { id: string }) => item.id)).toEqual([visible.id]);
		const persistedVisible = await db.query.tasksTable.findFirst({ where: { id: visible.id } });
		expect(persistedVisible?.persistenceFormatVersion).toBe(TASK_PERSISTENCE_FORMAT_VERSION);
		expect(activeResponse.status).toBe(200);
		expect(await activeResponse.json()).toEqual([
			expect.objectContaining({
				id: visible.id,
				kind: "deleteSnapshots",
				input: expect.objectContaining({ snapshotIds: ["snapshot-1"] }),
			}),
		]);
	});

	test("excludes unversioned legacy rows before counting and paginating", async () => {
		const valid = createRepositoryTask(session.organizationId, "valid-task");
		setCreatedAt(valid.id, 1);

		for (const [corruptionIndex, corruption] of legacyTaskCorruptions.entries()) {
			for (let repeat = 0; repeat < 5; repeat += 1) {
				const index = corruptionIndex * 5 + repeat;
				const id = `legacy-malformed-${String(index).padStart(2, "0")}`;
				createRepositoryTask(session.organizationId, id);
				db.update(tasksTable)
					.set({
						createdAt: index + 2,
						persistenceFormatVersion: null,
					})
					.where(eq(tasksTable.id, id))
					.run();
				corruptTask(id, corruption);
			}
		}
		const legacyValid = createRepositoryTask(session.organizationId, "legacy-valid");
		db.update(tasksTable)
			.set({
				createdAt: 100,
				persistenceFormatVersion: null,
			})
			.where(eq(tasksTable.id, legacyValid.id))
			.run();

		const response = await app.request("/api/v1/tasks/history", {
			headers: session.headers,
		});
		const page = await response.json();

		expect(page.items.map((item: { id: string }) => item.id)).toEqual([valid.id]);
		expect(page).toMatchObject({
			page: 1,
			pageSize: 25,
			totalItems: 1,
			totalPages: 1,
		});
	});

	test("rejects invalid filters and page numbers", async () => {
		for (const query of ["kind=futureTask", "outcome=unknown", "page=0", "page=-1", "page=abc", "page=1.5"]) {
			const response = await app.request(`/api/v1/tasks/history?${query}`, {
				headers: session.headers,
			});
			expect(response.status).toBe(400);
		}
	});
});
