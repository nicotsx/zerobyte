import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { serverEvents } from "~/server/core/events";
import { db } from "~/server/db/db";
import { tasksTable } from "~/server/db/schema";
import type { ServerEventPayloadMap } from "~/schemas/server-events";
import { ensureTestOrganization, TEST_ORG_ID } from "~/test/helpers/organization";
import { TaskCancelledError, requestTaskCancel, runTaskLifecycle } from "../tasks.lifecycle";
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
				previousOutcome: "running",
				item: expect.objectContaining({
					id: task.id,
					kind: "deleteSnapshots",
					status: "running",
					outcome: "running",
				}),
			}),
			expect.objectContaining({
				previousOutcome: "running",
				item: expect.objectContaining({ id: task.id, status: "succeeded", outcome: "success" }),
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
			expect.objectContaining({ item: expect.objectContaining({ id: task.id, outcome: "running" }) }),
			expect.objectContaining({
				previousOutcome: "running",
				item: expect.objectContaining({ id: task.id, outcome: "error", message: "start failed" }),
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

		expect(changes.at(-1)).toEqual(
			expect.objectContaining({ item: expect.objectContaining({ id: task.id, outcome: "cancelled" }) }),
		);
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
			expect.objectContaining({ item: expect.objectContaining({ id: task.id, outcome: "running" }) }),
			expect.objectContaining({ item: expect.objectContaining({ id: task.id, outcome: "cancelled" }) }),
		]);
	});

	test("does not run success or failure callbacks after startup already marked the task stale", async () => {
		const task = createTask("task-lifecycle-stale-success");
		const onSucceeded = vi.fn();
		const beforeFail = vi.fn();

		await runTaskLifecycle({
			taskId: task.id,
			label: "test task",
			run: async () => {
				taskStore.markActiveStale({ error: "Zerobyte restarted" });
				return { kind: "deleteSnapshots", deletedSnapshotIds: ["snapshot-1"] };
			},
			onSucceeded,
			beforeFail,
		});

		const staleTask = taskStore.findById({ organizationId: TEST_ORG_ID, taskId: task.id });
		expect(staleTask).toMatchObject({ status: "stale", error: "Zerobyte restarted" });
		expect(onSucceeded).not.toHaveBeenCalled();
		expect(beforeFail).not.toHaveBeenCalled();
	});

	test("does not run failure or cancellation callbacks after the task is stale", async () => {
		const failedTask = createTask("task-lifecycle-stale-failure");
		const beforeFail = vi.fn();
		await runTaskLifecycle({
			taskId: failedTask.id,
			label: "test task",
			run: async () => {
				taskStore.markActiveStale({ error: "Zerobyte restarted" });
				throw new Error("late failure");
			},
			beforeFail,
		});

		const cancelledTask = createTask("task-lifecycle-stale-cancel");
		const beforeCancel = vi.fn();
		await runTaskLifecycle({
			taskId: cancelledTask.id,
			label: "test task",
			run: async () => {
				taskStore.markActiveStale({ error: "Zerobyte restarted" });
				throw new TaskCancelledError("late cancellation");
			},
			beforeCancel,
		});

		expect(beforeFail).not.toHaveBeenCalled();
		expect(beforeCancel).not.toHaveBeenCalled();
	});
});
