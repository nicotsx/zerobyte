import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ListTasksResponse } from "~/client/api-client";
import { cleanup, createTestQueryClient, render, waitFor } from "~/test/test-utils";
import { taskChangedEventName, tasksSnapshotEventName } from "~/schemas/task-events";
import type { TaskDto } from "~/schemas/tasks";
import { HttpResponse, http, server } from "~/test/msw/server";
import { taskEventsOptions, useActiveTasks, type TaskOfKind } from "../use-active-tasks";

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

const ActiveTasksConsumer = ({ onTaskFinished }: { onTaskFinished: (task: TaskOfKind<"restore">) => void }) => {
	useActiveTasks(filter, { onTaskFinished });
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
});
