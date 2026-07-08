import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ListTasksResponse } from "~/client/api-client";
import { cleanup, createTestQueryClient, render, waitFor } from "~/test/test-utils";
import { taskChangedEventName } from "~/schemas/task-events";
import type { TaskDto } from "~/schemas/tasks";
import { taskEventsOptions, useTaskEvents } from "../use-task-events";

class MockEventSource {
	static instances: MockEventSource[] = [];

	onerror: ((event: Event) => void) | null = null;
	private listeners = new Map<string, Set<(event: Event) => void>>();

	constructor(public url: string) {
		MockEventSource.instances.push(this);
	}

	addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
		const listeners = this.listeners.get(type) ?? new Set<(event: Event) => void>();
		const callback = typeof listener === "function" ? listener : (event: Event) => listener.handleEvent(event);
		listeners.add(callback);
		this.listeners.set(type, listeners);
	}

	emit(type: string, data: unknown) {
		const event = new MessageEvent(type, {
			data: JSON.stringify(data),
		});

		for (const listener of this.listeners.get(type) ?? []) {
			listener(event);
		}
	}

	close() {}

	static reset() {
		MockEventSource.instances = [];
	}
}

const originalEventSource = globalThis.EventSource;

const filter = {
	kind: "deleteSnapshots",
	resourceType: "repository",
	resourceId: "repo-1",
} as const;

const activeTask: TaskDto = {
	id: "task-delete",
	kind: "deleteSnapshots",
	status: "running",
	resourceType: "repository",
	resourceId: "repo-1",
	targetAgentId: null,
	input: {
		kind: "deleteSnapshots",
		repositoryId: "repo-1",
		snapshotIds: ["snap-1"],
	},
	progress: null,
	result: null,
	error: null,
	cancellationRequested: false,
	createdAt: 1711411200000,
	startedAt: 1711411200000,
	updatedAt: 1711411200000,
	finishedAt: null,
};

const finishedTask: TaskDto = {
	...activeTask,
	status: "succeeded",
	result: { kind: "deleteSnapshots", deletedSnapshotIds: ["snap-1"] },
	updatedAt: 1711411201000,
	finishedAt: 1711411201000,
};

const TaskEventsConsumer = ({ onTaskFinished }: { onTaskFinished: (task: TaskDto) => void }) => {
	useTaskEvents(filter, { onTaskFinished });
	return null;
};

describe("useTaskEvents", () => {
	beforeEach(() => {
		MockEventSource.reset();
		globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
	});

	afterEach(() => {
		cleanup();
		globalThis.EventSource = originalEventSource;
		MockEventSource.reset();
	});

	test("ignores stale active events after a task has finished", async () => {
		const queryClient = createTestQueryClient();
		const onTaskFinished = vi.fn();

		render(<TaskEventsConsumer onTaskFinished={onTaskFinished} />, { queryClient });

		await waitFor(() => {
			expect(MockEventSource.instances).toHaveLength(1);
		});

		MockEventSource.instances[0]?.emit(taskChangedEventName, finishedTask);
		await waitFor(() => {
			expect(onTaskFinished).toHaveBeenCalledTimes(1);
		});

		MockEventSource.instances[0]?.emit(taskChangedEventName, activeTask);

		await waitFor(() => {
			expect(queryClient.getQueryData<ListTasksResponse>(taskEventsOptions(filter).queryKey)).toEqual([]);
		});
		expect(onTaskFinished).toHaveBeenCalledTimes(1);
	});
});
