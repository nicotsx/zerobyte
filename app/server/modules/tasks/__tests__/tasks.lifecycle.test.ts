import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { serverEvents } from "~/server/core/events";
import { db } from "~/server/db/db";
import { tasksTable } from "~/server/db/schema";
import type { ServerEventPayloadMap } from "~/schemas/server-events";
import { ensureTestOrganization, TEST_ORG_ID } from "~/test/helpers/organization";
import { requestTaskCancel, runTaskLifecycle } from "../tasks.lifecycle";
import { taskStore } from "../tasks.store";

const listenerCleanups: Array<() => void> = [];

const createTask = (id: string) => {
	return taskStore.create({
		id,
		organizationId: TEST_ORG_ID,
		resourceType: "repository",
		resourceId: "repo-short",
		targetDisplayName: "Test repository",
		input: {
			kind: "deleteSnapshots",
			repositoryId: "repo-short",
			snapshotIds: ["snapshot-1"],
		},
	});
};

const observeTaskHistoryChanges = () => {
	const changes: ServerEventPayloadMap["task:history-changed"][] = [];
	const recordChange = (event: ServerEventPayloadMap["task:history-changed"]) => changes.push(event);

	serverEvents.on("task:history-changed", recordChange);
	listenerCleanups.push(() => serverEvents.off("task:history-changed", recordChange));

	return changes;
};

beforeEach(async () => {
	await ensureTestOrganization();
	await db.delete(tasksTable);
});

afterEach(() => {
	for (const cleanup of listenerCleanups.splice(0)) {
		cleanup();
	}
});

describe("runTaskLifecycle", () => {
	test("emits history changes for lifecycle transitions", async () => {
		const task = createTask("task-lifecycle-success");
		const changes = observeTaskHistoryChanges();

		await runTaskLifecycle({
			taskId: task.id,
			label: "test task",
			run: async () => ({ kind: "deleteSnapshots", deletedSnapshotIds: ["snapshot-1"] }),
		});

		expect(changes).toEqual([
			expect.objectContaining({
				taskId: task.id,
				kind: "deleteSnapshots",
				previousOutcome: "running",
				outcome: "running",
			}),
			expect.objectContaining({
				taskId: task.id,
				previousOutcome: "running",
				outcome: "success",
			}),
		]);
	});

	test("emits the terminal error outcome when start work fails", async () => {
		const task = createTask("task-lifecycle-start-failure");
		const changes = observeTaskHistoryChanges();

		await runTaskLifecycle({
			taskId: task.id,
			label: "test task",
			onStarted: async () => {
				throw new Error("start failed");
			},
			run: async () => ({ kind: "deleteSnapshots", deletedSnapshotIds: ["snapshot-1"] }),
		});

		expect(changes).toEqual([
			expect.objectContaining({ taskId: task.id, outcome: "running" }),
			expect.objectContaining({
				taskId: task.id,
				previousOutcome: "running",
				outcome: "error",
			}),
		]);
	});

	test("emits the terminal cancellation outcome", async () => {
		const task = createTask("task-lifecycle-cancelled");
		const changes = observeTaskHistoryChanges();
		let resolveRunStarted: (() => void) | undefined;
		const runStarted = new Promise<void>((resolve) => {
			resolveRunStarted = resolve;
		});

		const lifecycle = runTaskLifecycle({
			taskId: task.id,
			label: "test task",
			cancellable: true,
			run: (signal) => {
				resolveRunStarted?.();

				return new Promise<never>((_, reject) => {
					signal.addEventListener(
						"abort",
						() => {
							const error = new Error("cancelled");
							error.name = "AbortError";
							reject(error);
						},
						{ once: true },
					);
				});
			},
		});

		await runStarted;
		expect(requestTaskCancel(task.id)).toBe(true);
		await lifecycle;

		expect(changes.at(-1)).toEqual(expect.objectContaining({ taskId: task.id, outcome: "cancelled" }));
	});

	test("keeps cancellable tasks queued while they prepare", async () => {
		const task = createTask("task-lifecycle-queued");
		const changes = observeTaskHistoryChanges();
		let executionStarted = false;

		const lifecycle = runTaskLifecycle({
			taskId: task.id,
			label: "test task",
			cancellable: true,
			prepare: (signal) =>
				new Promise<never>((_, reject) => {
					signal.addEventListener("abort", () => reject(signal.reason), { once: true });
				}),
			run: async () => {
				executionStarted = true;
				return { kind: "deleteSnapshots", deletedSnapshotIds: ["snapshot-1"] };
			},
		});

		await Promise.resolve();
		const queuedTask = taskStore.findById({ organizationId: TEST_ORG_ID, taskId: task.id });
		expect(queuedTask?.status).toBe("queued");
		expect(requestTaskCancel(task.id)).toBe(true);
		await lifecycle;

		expect(executionStarted).toBe(false);
		expect(changes).toEqual([
			expect.objectContaining({ taskId: task.id, outcome: "running" }),
			expect.objectContaining({ taskId: task.id, outcome: "cancelled" }),
		]);
	});
});
