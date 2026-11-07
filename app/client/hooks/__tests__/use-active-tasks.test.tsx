import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getTaskOptions } from "~/client/api-client/@tanstack/react-query.gen";
import type { ListTasksResponse } from "~/client/api-client";
import { cleanup, createTestQueryClient, render, screen, waitFor } from "~/test/test-utils";
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
	const { data } = useActiveTasks(query, options);

	return (
		<output aria-label={`Tasks for ${query.resourceId ?? "all"}`}>{data.map((task) => task.id).join(",")}</output>
	);
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

	test("keeps task subscriptions below the HTTP connection limit across many filters", async () => {
		const queryClient = createTestQueryClient();
		const queries = Array.from({ length: 8 }, (_, index) => ({ ...filter, resourceId: `repo-${index}` }));

		queryClient.setQueryData(taskEventsOptions(filter).queryKey, []);

		const view = render(
			<>
				{queries.map((query) => (
					<ActiveTasksConsumer key={query.resourceId} query={query} onTaskFinished={vi.fn()} />
				))}
			</>,
			{ queryClient, withSuspense: true },
		);

		await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0));
		expect(MockEventSource.instances).toHaveLength(1);

		MockEventSource.instances[0]?.emit(tasksSnapshotEventName, [activeTask]);

		await waitFor(() => {
			expect(screen.getByRole("status", { name: "Tasks for repo-1" }).textContent).toBe(activeTask.id);
		});
		expect(screen.getByRole("status", { name: "Tasks for repo-0" }).textContent).toBe("");

		view.unmount();
		expect(MockEventSource.instances[0]?.close).toHaveBeenCalledOnce();
	});

	test.each([
		{ kind: "backup" as const },
		{ resourceType: "backup_schedule" as const },
		{ resourceId: "another-repository" },
		{ operationKey: "another-snapshot" },
	])("ignores unrelated task snapshots and changes for %j", async (otherScope) => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(taskEventsOptions(filter).queryKey, []);
		const onTaskFinished = vi.fn();
		const onTaskActivity = vi.fn();
		const onTasksSnapshot = vi.fn();

		render(<ActiveTasksConsumer {...{ onTaskFinished, onTaskActivity, onTasksSnapshot }} />, {
			queryClient,
			withSuspense: true,
		});

		await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
		const stream = MockEventSource.instances[0]!;
		stream.emit(tasksSnapshotEventName, [{ ...activeTask, ...otherScope }]);
		stream.emit(taskChangedEventName, { ...activeTask, ...otherScope });
		stream.emit(taskChangedEventName, { ...finishedTask, ...otherScope });

		expect(onTasksSnapshot).toHaveBeenCalledExactlyOnceWith([]);
		expect(onTaskActivity).not.toHaveBeenCalled();
		expect(onTaskFinished).not.toHaveBeenCalled();
		expect(queryClient.getQueryData(taskEventsOptions(filter).queryKey)).toEqual([]);
	});

	test("replays current tasks to late consumers and keeps the stream until the last consumer leaves", async () => {
		const queryClient = createTestQueryClient();
		const otherFilter = { ...filter, resourceId: "repo-2" };
		const otherTask = { ...activeTask, id: "other-task", resourceId: "repo-2" };
		queryClient.setQueryData(taskEventsOptions(filter).queryKey, []);
		const first = render(<ActiveTasksConsumer onTaskFinished={vi.fn()} />, { queryClient, withSuspense: true });

		await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
		const stream = MockEventSource.instances[0]!;
		stream.emit(tasksSnapshotEventName, []);
		stream.emit(taskChangedEventName, otherTask);
		const onTasksSnapshot = vi.fn();
		const onTaskFinished = vi.fn();
		const second = render(<ActiveTasksConsumer query={otherFilter} {...{ onTasksSnapshot, onTaskFinished }} />, {
			queryClient,
			withSuspense: true,
		});

		await waitFor(() => expect(onTasksSnapshot).toHaveBeenCalledExactlyOnceWith([otherTask]));
		expect(MockEventSource.instances).toHaveLength(1);
		first.unmount();
		expect(stream.close).not.toHaveBeenCalled();

		const otherFinishedTask = { ...finishedTask, id: otherTask.id, resourceId: otherTask.resourceId };
		stream.emit(taskChangedEventName, otherFinishedTask);
		await waitFor(() => expect(onTaskFinished).toHaveBeenCalledExactlyOnceWith(otherFinishedTask));
		expect(queryClient.getQueryData(taskEventsOptions(otherFilter).queryKey)).toEqual([]);

		second.unmount();
		expect(stream.close).toHaveBeenCalledOnce();
	});

	test("reconciles tasks that finish while the shared stream is reconnecting", async () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(taskEventsOptions(filter).queryKey, [activeTask]);
		server.use(http.get("/api/v1/tasks/:taskId", () => HttpResponse.json(finishedTask)));
		const onTaskFinished = vi.fn();

		render(<ActiveTasksConsumer onTaskFinished={onTaskFinished} />, { queryClient, withSuspense: true });
		await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
		const stream = MockEventSource.instances[0]!;
		stream.emit(tasksSnapshotEventName, [activeTask]);
		stream.emit(tasksSnapshotEventName, []);

		await waitFor(() => expect(onTaskFinished).toHaveBeenCalledExactlyOnceWith(finishedTask));
		expect(queryClient.getQueryData(taskEventsOptions(filter).queryKey)).toEqual([]);
		expect(MockEventSource.instances).toHaveLength(1);
	});

	test("reports a missed completion to every consumer of the same task query", async () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(taskEventsOptions(filter).queryKey, [activeTask]);
		server.use(http.get("/api/v1/tasks/:taskId", () => HttpResponse.json(finishedTask)));
		const firstFinished = vi.fn();
		const secondFinished = vi.fn();

		render(
			<>
				<ActiveTasksConsumer onTaskFinished={firstFinished} />
				<ActiveTasksConsumer onTaskFinished={secondFinished} />
			</>,
			{ queryClient, withSuspense: true },
		);

		await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
		MockEventSource.instances[0]!.emit(tasksSnapshotEventName, []);

		await waitFor(() => {
			expect(firstFinished).toHaveBeenCalledExactlyOnceWith(finishedTask);
			expect(secondFinished).toHaveBeenCalledExactlyOnceWith(finishedTask);
		});
	});

	test("keeps delivering updates when another consumer throws", async () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(taskEventsOptions(filter).queryKey, []);
		const onTaskActivity = vi.fn();
		const logError = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			render(
				<>
					<ActiveTasksConsumer
						onTaskFinished={vi.fn()}
						onTaskActivity={() => {
							throw new Error("Callback failed");
						}}
					/>
					<ActiveTasksConsumer onTaskFinished={vi.fn()} onTaskActivity={onTaskActivity} />
				</>,
				{ queryClient, withSuspense: true },
			);

			await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
			expect(() => MockEventSource.instances[0]!.emit(taskChangedEventName, activeTask)).not.toThrow();
			expect(onTaskActivity).toHaveBeenCalledExactlyOnceWith(activeTask);
		} finally {
			logError.mockRestore();
		}
	});

	test("shares the initial HTTP snapshot while selecting each consumer's tasks", async () => {
		const otherTask = { ...activeTask, id: "other-task", resourceId: "repo-2" };
		let requests = 0;
		server.use(
			http.get("/api/v1/tasks", () => {
				requests += 1;
				return HttpResponse.json([activeTask, otherTask]);
			}),
		);

		render(
			<>
				<ActiveTasksConsumer onTaskFinished={vi.fn()} />
				<ActiveTasksConsumer query={{ ...filter, resourceId: "repo-2" }} onTaskFinished={vi.fn()} />
			</>,
			{ withSuspense: true },
		);

		await waitFor(() => {
			expect(screen.getByRole("status", { name: "Tasks for repo-1" }).textContent).toBe(activeTask.id);
			expect(screen.getByRole("status", { name: "Tasks for repo-2" }).textContent).toBe(otherTask.id);
		});
		expect(requests).toBe(1);
		expect(MockEventSource.instances).toHaveLength(1);
	});

	test("preserves active task order when an existing task reports progress", async () => {
		const queryClient = createTestQueryClient();
		const otherTask = { ...activeTask, id: "other-task" };
		queryClient.setQueryData(taskEventsOptions(filter).queryKey, [activeTask, otherTask]);

		render(<ActiveTasksConsumer onTaskFinished={vi.fn()} />, { queryClient });
		MockEventSource.instances[0]!.emit(taskChangedEventName, { ...otherTask, updatedAt: otherTask.updatedAt + 1 });

		expect(queryClient.getQueryData(taskEventsOptions(filter).queryKey)?.map((task) => task.id)).toEqual([
			activeTask.id,
			otherTask.id,
		]);

		await waitFor(() => {
			expect(screen.getByRole("status", { name: "Tasks for repo-1" }).textContent).toBe(
				`${activeTask.id},${otherTask.id}`,
			);
		});
	});

	test("keeps snapshot delivery independent of consumer callback failures", async () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(taskEventsOptions(filter).queryKey, []);
		const onTasksSnapshot = vi.fn();
		const logError = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			render(
				<>
					<ActiveTasksConsumer
						onTaskFinished={vi.fn()}
						onTasksSnapshot={() => {
							throw new Error("Callback failed");
						}}
					/>
					<ActiveTasksConsumer onTaskFinished={vi.fn()} onTasksSnapshot={onTasksSnapshot} />
				</>,
				{ queryClient },
			);

			expect(() => MockEventSource.instances[0]!.emit(tasksSnapshotEventName, [activeTask])).not.toThrow();
			expect(onTasksSnapshot).toHaveBeenCalledExactlyOnceWith([activeTask]);
		} finally {
			logError.mockRestore();
		}
	});

	test("discards reconciliation results after the last subscriber disconnects", async () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(taskEventsOptions(filter).queryKey, [activeTask]);
		let resolveResponse!: (response: Response) => void;
		const response = new Promise<Response>((resolve) => {
			resolveResponse = resolve;
		});
		const requestReceived = vi.fn();
		server.use(
			http.get("/api/v1/tasks/:taskId", () => {
				requestReceived();
				return response;
			}),
		);
		const onTaskFinished = vi.fn();
		const view = render(<ActiveTasksConsumer onTaskFinished={onTaskFinished} />, { queryClient });
		MockEventSource.instances[0]!.emit(tasksSnapshotEventName, []);
		await waitFor(() => expect(requestReceived).toHaveBeenCalledOnce());

		view.unmount();
		queryClient.setQueryData(taskEventsOptions(filter).queryKey, [activeTask]);
		resolveResponse(HttpResponse.json(finishedTask));
		await waitFor(() => {
			expect(
				queryClient.isFetching({ queryKey: getTaskOptions({ path: { taskId: activeTask.id } }).queryKey }),
			).toBe(0);
		});

		expect(onTaskFinished).not.toHaveBeenCalled();
		expect(queryClient.getQueryData(taskEventsOptions(filter).queryKey)).toEqual([activeTask]);
	});

	test("uses an origin-independent query key for SSR hydration", () => {
		const taskOptions = taskEventsOptions(filter);

		expect(taskOptions.staleTime).toBe("static");
		expect(taskOptions.queryKey).toEqual(["active-tasks"]);
		expect(taskEventsOptions({ ...filter, resourceId: "repo-2" }).queryKey).toEqual(taskOptions.queryKey);
	});

	test("fetches the shared initial snapshot and reports a finished restore once", async () => {
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
		expect(initialSnapshotUrl?.search).toBe("");
		expect(queryClient.getQueryData<ListTasksResponse>(taskEventsOptions(filter).queryKey)).toEqual([activeTask]);
		expect(MockEventSource.instances[0]?.url).toBe("/api/v1/tasks/events");

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

	test("changes the selected tasks without reconnecting the shared stream", async () => {
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
		queryClient.setQueryData(taskEventsOptions(filter).queryKey, [activeTask, nextTask]);
		const onTaskFinished = vi.fn();
		const { rerender } = render(<ActiveTasksConsumer onTaskFinished={onTaskFinished} />, {
			queryClient,
			withSuspense: true,
		});
		await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

		rerender(<ActiveTasksConsumer query={nextFilter} onTaskFinished={onTaskFinished} />);
		await waitFor(() => {
			expect(screen.getByRole("status", { name: "Tasks for repo-1" }).textContent).toBe(nextTask.id);
		});
		expect(MockEventSource.instances).toHaveLength(1);
		expect(MockEventSource.instances[0]?.close).not.toHaveBeenCalled();
		MockEventSource.instances[0]?.emit(tasksSnapshotEventName, [activeTask, nextTask]);
		MockEventSource.instances[0]?.emit(taskChangedEventName, nextFinishedTask);

		await waitFor(() => expect(onTaskFinished).toHaveBeenCalledExactlyOnceWith(nextFinishedTask));
		expect(queryClient.getQueryData(taskEventsOptions(filter).queryKey)).toEqual([activeTask]);
		await waitFor(() => expect(screen.getByRole("status", { name: "Tasks for repo-1" }).textContent).toBe(""));
	});
});
