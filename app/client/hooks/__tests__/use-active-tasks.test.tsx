import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ListTasksResponse } from "~/client/api-client";
import { cleanup, createTestQueryClient, render, waitFor } from "~/test/test-utils";
import { taskChangedEventName, tasksSnapshotEventName } from "~/schemas/task-events";
import type { TaskDto } from "~/schemas/tasks";
import { HttpResponse, http, server } from "~/test/msw/server";
import { taskEventsOptions, useActiveTasks, type TaskEventsQuery, type TaskOfKind } from "../use-active-tasks";

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

	close = vi.fn(() => this.listeners.clear());

	static reset() {
		MockEventSource.instances = [];
	}
}

const originalEventSource = globalThis.EventSource;

const filter = {
	kind: "restore",
	resourceType: "repository",
	resourceId: "repo-1",
	operationKey: "snap-1",
} as const;

const activeTask: TaskDto = {
	id: "task-restore",
	kind: "restore",
	status: "running",
	resourceType: "repository",
	resourceId: "repo-1",
	operationKey: "snap-1",
	targetAgentId: null,
	input: {
		kind: "restore",
		repositoryId: "repo-1",
		snapshotId: "snap-1",
		target: "/restore",
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
	result: {
		kind: "restore",
		result: { message_type: "summary", files_restored: 1, files_skipped: 0 },
	},
	updatedAt: 1711411201000,
	finishedAt: 1711411201000,
};

const ActiveTasksConsumer = ({
	query = filter,
	...options
}: {
	query?: TaskEventsQuery & { kind: "restore" };
	onTaskFinished: (task: TaskOfKind<"restore">) => void;
	onTaskActivity?: (task: TaskOfKind<"restore">) => void;
	onTasksSnapshot?: (tasks: TaskOfKind<"restore">[]) => void;
}) => {
	useActiveTasks(query, options);
	return null;
};

describe("useActiveTasks", () => {
	beforeEach(() => {
		MockEventSource.reset();
		globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
	});

	afterEach(() => {
		cleanup();
		globalThis.EventSource = originalEventSource;
		MockEventSource.reset();
	});

	test("uses an origin-independent query key for SSR hydration", () => {
		const taskOptions = taskEventsOptions(filter);

		expect(taskOptions.staleTime).toBe("static");
		expect(taskOptions.queryKey).toEqual([
			"active-tasks",
			{
				kind: "restore",
				resourceType: "repository",
				resourceId: "repo-1",
				operationKey: "snap-1",
			},
		]);
	});

	test("fetches the initial snapshot and uses the exact event stream while reporting a finished restore once", async () => {
		const queryClient = createTestQueryClient();
		const onTaskFinished = vi.fn();
		let initialSnapshotUrl: URL | undefined;
		server.use(
			http.get("/api/v1/tasks", ({ request }) => {
				initialSnapshotUrl = new URL(request.url);
				return HttpResponse.json([activeTask]);
			}),
		);

		render(<ActiveTasksConsumer onTaskFinished={onTaskFinished} />, { queryClient, withSuspense: true });

		await waitFor(() => {
			expect(MockEventSource.instances).toHaveLength(1);
		});
		expect(initialSnapshotUrl?.searchParams.get("kind")).toBe("restore");
		expect(initialSnapshotUrl?.searchParams.get("resourceType")).toBe("repository");
		expect(initialSnapshotUrl?.searchParams.get("resourceId")).toBe("repo-1");
		expect(initialSnapshotUrl?.searchParams.get("operationKey")).toBe("snap-1");
		expect(queryClient.getQueryData<ListTasksResponse>(taskEventsOptions(filter).queryKey)).toEqual([activeTask]);
		expect(MockEventSource.instances[0]?.url).toBe(
			"/api/v1/tasks/events?kind=restore&resourceType=repository&resourceId=repo-1&operationKey=snap-1",
		);

		MockEventSource.instances[0]?.emit(tasksSnapshotEventName, [activeTask]);
		await waitFor(() => {
			expect(queryClient.getQueryData<ListTasksResponse>(taskEventsOptions(filter).queryKey)).toEqual([
				activeTask,
			]);
		});

		MockEventSource.instances[0]?.emit(taskChangedEventName, finishedTask);
		await waitFor(() => {
			expect(onTaskFinished).toHaveBeenCalledTimes(1);
		});
		expect(onTaskFinished.mock.calls[0]?.[0].input.snapshotId).toBe("snap-1");

		MockEventSource.instances[0]?.emit(taskChangedEventName, activeTask);

		await waitFor(() => {
			expect(queryClient.getQueryData<ListTasksResponse>(taskEventsOptions(filter).queryKey)).toEqual([]);
		});
		expect(onTaskFinished).toHaveBeenCalledTimes(1);
	});

	test("uses the latest callbacks without reconnecting the task stream", async () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(taskEventsOptions(filter).queryKey, [activeTask]);
		const previousCallbacks = { onTaskFinished: vi.fn(), onTaskActivity: vi.fn(), onTasksSnapshot: vi.fn() };
		const nextCallbacks = { onTaskFinished: vi.fn(), onTaskActivity: vi.fn(), onTasksSnapshot: vi.fn() };
		const { rerender } = render(<ActiveTasksConsumer {...previousCallbacks} />, {
			queryClient,
			withSuspense: true,
		});
		await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
		rerender(<ActiveTasksConsumer {...nextCallbacks} />);
		MockEventSource.instances[0]?.emit(tasksSnapshotEventName, [activeTask]);
		MockEventSource.instances[0]?.emit(taskChangedEventName, activeTask);
		MockEventSource.instances[0]?.emit(taskChangedEventName, finishedTask);
		await waitFor(() => expect(nextCallbacks.onTaskFinished).toHaveBeenCalledWith(finishedTask));
		expect(nextCallbacks.onTasksSnapshot).toHaveBeenCalledWith([activeTask]);
		expect(nextCallbacks.onTaskActivity).toHaveBeenCalledWith(activeTask);
		expect(nextCallbacks.onTaskActivity).toHaveBeenCalledWith(finishedTask);
		expect(previousCallbacks.onTaskFinished).not.toHaveBeenCalled();
		expect(previousCallbacks.onTaskActivity).not.toHaveBeenCalled();
		expect(previousCallbacks.onTasksSnapshot).not.toHaveBeenCalled();
		expect(MockEventSource.instances).toHaveLength(1);
	});

	test("replaces the stream when the filter changes and updates only the matching task cache", async () => {
		const queryClient = createTestQueryClient();
		const nextFilter = { ...filter, operationKey: "snap-2" };
		const nextTask: TaskDto = {
			...activeTask,
			id: "task-restore-2",
			operationKey: "snap-2",
			input: { kind: "restore", repositoryId: "repo-1", snapshotId: "snap-2", target: "/restore" },
		};
		const nextFinishedTask: TaskDto = {
			...nextTask,
			status: "succeeded",
			result: finishedTask.result,
			updatedAt: finishedTask.updatedAt,
			finishedAt: finishedTask.finishedAt,
		};
		queryClient.setQueryData(taskEventsOptions(filter).queryKey, [activeTask]);
		queryClient.setQueryData(taskEventsOptions(nextFilter).queryKey, [nextTask]);
		const onTaskFinished = vi.fn();
		const { rerender } = render(<ActiveTasksConsumer onTaskFinished={onTaskFinished} />, {
			queryClient,
			withSuspense: true,
		});
		await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

		rerender(<ActiveTasksConsumer query={nextFilter} onTaskFinished={onTaskFinished} />);
		await waitFor(() => expect(MockEventSource.instances).toHaveLength(2));
		expect(MockEventSource.instances[0]?.close).toHaveBeenCalledOnce();
		expect(MockEventSource.instances[1]?.url).toContain("operationKey=snap-2");
		MockEventSource.instances[1]?.emit(tasksSnapshotEventName, [nextTask]);
		MockEventSource.instances[1]?.emit(taskChangedEventName, nextFinishedTask);

		await waitFor(() => expect(onTaskFinished).toHaveBeenCalledExactlyOnceWith(nextFinishedTask));
		expect(queryClient.getQueryData(taskEventsOptions(nextFilter).queryKey)).toEqual([]);
		expect(queryClient.getQueryData(taskEventsOptions(filter).queryKey)).toEqual([activeTask]);
	});
});
