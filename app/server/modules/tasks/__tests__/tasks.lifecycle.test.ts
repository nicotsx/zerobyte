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
		input: {
			kind: "deleteSnapshots",
			repositoryId: "repo-short",
			snapshotIds: ["snapshot-1"],
		},
	});
};

const observeLifecycleEvents = () => {
	const started: ServerEventPayloadMap["task:started"][] = [];
	const finished: ServerEventPayloadMap["task:finished"][] = [];
	const onStarted = (event: ServerEventPayloadMap["task:started"]) => started.push(event);
	const onFinished = (event: ServerEventPayloadMap["task:finished"]) => finished.push(event);

	serverEvents.on("task:started", onStarted);
	serverEvents.on("task:finished", onFinished);
	listenerCleanups.push(() => serverEvents.off("task:started", onStarted));
	listenerCleanups.push(() => serverEvents.off("task:finished", onFinished));

	return { started, finished };
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
	test("emits lifecycle events after start and execution work complete", async () => {
		const task = createTask("task-lifecycle-success");
		const events = observeLifecycleEvents();
		let startWorkCompleted = false;
		let executionCompleted = false;
		const observedWorkState: Array<{ startWorkCompleted: boolean; executionCompleted: boolean }> = [];
		const recordWorkState = () => observedWorkState.push({ startWorkCompleted, executionCompleted });

		serverEvents.on("task:started", recordWorkState);
		serverEvents.on("task:finished", recordWorkState);
		listenerCleanups.push(() => serverEvents.off("task:started", recordWorkState));
		listenerCleanups.push(() => serverEvents.off("task:finished", recordWorkState));

		await runTaskLifecycle({
			taskId: task.id,
			label: "test task",
			onStarted: async () => {
				await Promise.resolve();
				startWorkCompleted = true;
			},
			run: async () => {
				executionCompleted = true;
				return { kind: "deleteSnapshots", deletedSnapshotIds: ["snapshot-1"] };
			},
		});

		expect(events.started).toEqual([
			expect.objectContaining({
				taskId: task.id,
				kind: "deleteSnapshots",
				resourceType: "repository",
				resourceId: "repo-short",
				status: "running",
			}),
		]);
		expect(events.finished).toEqual([expect.objectContaining({ taskId: task.id, status: "succeeded" })]);
		expect(observedWorkState).toEqual([
			{ startWorkCompleted: true, executionCompleted: false },
			{ startWorkCompleted: true, executionCompleted: true },
		]);
	});

	test("emits only a finished event when start work fails", async () => {
		const task = createTask("task-lifecycle-start-failure");
		const events = observeLifecycleEvents();

		await runTaskLifecycle({
			taskId: task.id,
			label: "test task",
			onStarted: async () => {
				throw new Error("start failed");
			},
			run: async () => ({ kind: "deleteSnapshots", deletedSnapshotIds: ["snapshot-1"] }),
		});

		expect(events.started).toEqual([]);
		expect(events.finished).toEqual([expect.objectContaining({ taskId: task.id, status: "failed" })]);
	});

	test("emits a finished event when cancellation completes", async () => {
		const task = createTask("task-lifecycle-cancelled");
		const events = observeLifecycleEvents();
		let resolveStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			resolveStarted = resolve;
		});
		const onStarted = () => resolveStarted?.();

		serverEvents.on("task:started", onStarted);
		listenerCleanups.push(() => serverEvents.off("task:started", onStarted));

		const lifecycle = runTaskLifecycle({
			taskId: task.id,
			label: "test task",
			run: (signal) =>
				new Promise<never>((_, reject) => {
					signal.addEventListener(
						"abort",
						() => {
							const error = new Error("cancelled");
							error.name = "AbortError";
							reject(error);
						},
						{ once: true },
					);
				}),
		});

		await started;
		expect(requestTaskCancel(task.id)).toBe(true);
		await lifecycle;

		expect(events.finished).toEqual([expect.objectContaining({ taskId: task.id, status: "cancelled" })]);
	});
});
