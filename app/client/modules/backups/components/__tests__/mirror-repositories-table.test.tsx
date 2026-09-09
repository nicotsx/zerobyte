import type { ReactNode } from "react";
import { fromPartial } from "@total-typescript/shoehorn";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { GetScheduleMirrorsResponse } from "~/client/api-client";
import type { Repository } from "~/client/lib/types";
import { taskChangedEventName } from "~/schemas/task-events";
import type { TaskDto, TaskStatus } from "~/schemas/tasks";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent, waitFor } from "~/test/test-utils";
import { mirrorStatusQueryKey } from "../../mirror-tasks";
import { MirrorRepositoriesTable } from "../mirror-repositories-table";

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();

	return {
		...actual,
		Link: (({ children }: { children?: ReactNode }) => <a href="/">{children}</a>) as typeof actual.Link,
	};
});

class MockEventSource {
	static urls: string[] = [];
	static instances: MockEventSource[] = [];

	onerror: ((event: Event) => void) | null = null;
	closed = false;
	private listeners = new Map<string, Set<(event: Event) => void>>();

	constructor(public url: string) {
		MockEventSource.urls.push(url);
		MockEventSource.instances.push(this);
	}

	addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
		const listeners = this.listeners.get(type) ?? new Set<(event: Event) => void>();
		const callback = typeof listener === "function" ? listener : (event: Event) => listener.handleEvent(event);
		listeners.add(callback);
		this.listeners.set(type, listeners);
	}

	emit(type: string, data: unknown) {
		if (this.closed) return;

		const event = new MessageEvent(type, { data: JSON.stringify(data) });
		const listeners = this.listeners.get(type) ?? [];

		for (const listener of listeners) {
			listener(event);
		}
	}

	close() {
		this.closed = true;
	}

	static reset() {
		MockEventSource.urls = [];
		MockEventSource.instances = [];
	}
}

const originalEventSource = globalThis.EventSource;
const mirror = fromPartial<Repository>({ shortId: "mirror-1", name: "Mirror 1", type: "local" });
const secondMirror = fromPartial<Repository>({ shortId: "mirror-2", name: "Mirror 2", type: "local" });
const currentMirrors: GetScheduleMirrorsResponse = [];
const assignments = new Map([[mirror.shortId, { repositoryId: mirror.shortId, enabled: true }]]);

const createMirrorStatusResult = (snapshotId = "snapshot-1") => {
	return {
		kind: "mirrorStatus" as const,
		sourceCount: 2,
		mirrorCount: 1,
		missingSnapshots: [{ short_id: snapshotId, time: "2026-03-26T00:00:00.000Z", size: 1024 }],
	};
};

const createMirrorStatusTask = (id: string, status: TaskStatus, error: string | null = null): TaskDto => {
	const succeeded = status === "succeeded";
	const result = succeeded ? createMirrorStatusResult() : null;
	const finishedAt = succeeded || status === "failed" ? 1711411200000 : null;
	const cancellationRequested = status === "cancelled";

	return {
		id,
		kind: "mirrorStatus",
		status,
		resourceType: "backup_schedule",
		resourceId: "backup-1",
		operationKey: "mirror-1",
		targetAgentId: null,
		input: {
			kind: "mirrorStatus",
			scheduleId: 1,
			scheduleShortId: "backup-1",
			sourceRepositoryId: "source-1",
			mirrorRepositoryId: "mirror-1",
		},
		progress: null,
		result,
		error,
		cancellationRequested,
		createdAt: 1711411200000,
		startedAt: 1711411200000,
		updatedAt: 1711411200000,
		finishedAt,
	};
};

const createTable = (
	options: {
		repositories?: Repository[];
		assignments?: Map<string, { repositoryId: string; enabled: boolean }>;
	} = {},
) => {
	const repositories = options.repositories ?? [mirror];
	const mirrorAssignments = options.assignments ?? assignments;

	return (
		<MirrorRepositoriesTable
			scheduleShortId="backup-1"
			repositories={repositories}
			currentMirrors={currentMirrors}
			assignments={mirrorAssignments}
			hasChanges={false}
			onToggleEnabled={vi.fn()}
			onRemove={vi.fn()}
		/>
	);
};

const renderTable = (options: Parameters<typeof createTable>[0] = {}) => {
	return render(createTable(options), { withSuspense: true });
};

const getTaskStream = async (taskId: string) => {
	const url = `/api/v1/tasks/${taskId}/events`;
	await waitFor(() => {
		expect(MockEventSource.instances.some((instance) => instance.url === url && !instance.closed)).toBe(true);
	});

	const taskStream = MockEventSource.instances.findLast((instance) => instance.url === url && !instance.closed);
	if (!taskStream) {
		throw new Error(`Expected task stream for ${taskId}`);
	}

	return taskStream;
};

const startStatusLookup = async (index = 0) => {
	const startLookups = await screen.findAllByRole("button", { name: "Sync more snapshots" });
	await userEvent.click(startLookups[index]);
};

beforeEach(() => {
	MockEventSource.reset();
	globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
	server.use(http.get("/api/v1/tasks", () => HttpResponse.json([])));
});

afterEach(() => {
	cleanup();
	globalThis.EventSource = originalEventSource;
	MockEventSource.reset();
});

test("reuses the pending start request when the dialog reopens before it finishes", async () => {
	const firstResponse = Promise.withResolvers<Response>();
	let startRequests = 0;
	server.use(
		http.post("/api/v1/backups/backup-1/mirrors/mirror-1/status", () => {
			startRequests++;
			return firstResponse.promise;
		}),
	);
	renderTable();

	await startStatusLookup();
	expect(await screen.findByText("Checking snapshot status...")).toBeTruthy();
	await userEvent.keyboard("{Escape}");

	await startStatusLookup();
	firstResponse.resolve(HttpResponse.json({ taskId: "task-current", status: "started" }, { status: 202 }));
	const taskStream = await getTaskStream("task-current");
	taskStream.emit(taskChangedEventName, createMirrorStatusTask("task-current", "succeeded"));

	expect(await screen.findByText("1 of 2 snapshots are missing in this mirror.")).toBeTruthy();
	expect(startRequests).toBe(1);
});

test("retrieves the completed background task when its dialog reopens", async () => {
	let startRequests = 0;
	server.use(
		http.post("/api/v1/backups/backup-1/mirrors/mirror-1/status", () => {
			startRequests++;
			const taskId = `task-background-${startRequests}`;
			return HttpResponse.json({ taskId, status: "started" }, { status: 202 });
		}),
	);
	renderTable();

	await startStatusLookup();
	const firstStream = await getTaskStream("task-background-1");
	firstStream.emit(taskChangedEventName, createMirrorStatusTask("task-background-1", "running"));
	await userEvent.keyboard("{Escape}");
	expect(firstStream.closed).toBe(true);

	const completedTask = createMirrorStatusTask("task-background-1", "succeeded");
	await startStatusLookup();
	const reopenedStream = await getTaskStream("task-background-1");
	reopenedStream.emit(taskChangedEventName, completedTask);

	expect(await screen.findByText("1 of 2 snapshots are missing in this mirror.")).toBeTruthy();
	expect(startRequests).toBe(1);
});

test.each([null, "running"] as const)("refreshes an old pending handle (%s) on opening", async (status) => {
	server.use(
		http.post("/api/v1/backups/backup-1/mirrors/mirror-1/status", () => {
			return HttpResponse.json({ taskId: "task-mirror-status", status: "started" }, { status: 202 });
		}),
	);
	const { queryClient } = renderTable();
	const queryKey = mirrorStatusQueryKey("backup-1", "mirror-1");
	const task = status === null ? null : createMirrorStatusTask("expired-task", status);
	queryClient.setQueryData(
		queryKey,
		{ taskId: "expired-task", task },
		{
			updatedAt: Date.now() - 25 * 60 * 60 * 1000,
		},
	);
	await startStatusLookup();
	const stream = await getTaskStream("task-mirror-status");
	stream.emit(taskChangedEventName, createMirrorStatusTask("task-mirror-status", "succeeded"));
	expect(await screen.findByText("1 of 2 snapshots are missing in this mirror.")).toBeTruthy();
});

test("reuses a completed snapshot status when the dialog reopens", async () => {
	let startRequests = 0;
	server.use(
		http.post("/api/v1/backups/backup-1/mirrors/mirror-1/status", () => {
			startRequests++;
			const taskId = `task-mirror-status-${startRequests}`;
			return HttpResponse.json({ taskId, status: "started" }, { status: 202 });
		}),
	);
	renderTable();

	await startStatusLookup();
	const taskStream = await getTaskStream("task-mirror-status-1");
	taskStream.emit(taskChangedEventName, createMirrorStatusTask("task-mirror-status-1", "succeeded"));

	expect(await screen.findByText("1 of 2 snapshots are missing in this mirror.")).toBeTruthy();
	await userEvent.keyboard("{Escape}");
	await startStatusLookup();

	expect(await screen.findByText("1 of 2 snapshots are missing in this mirror.")).toBeTruthy();
	expect(startRequests).toBe(1);
});

test("starts a fresh lookup after the cached status is invalidated", async () => {
	let startRequests = 0;
	server.use(
		http.post("/api/v1/backups/backup-1/mirrors/mirror-1/status", () => {
			startRequests++;
			const taskId = `task-mirror-status-${startRequests}`;
			return HttpResponse.json({ taskId, status: "started" }, { status: 202 });
		}),
	);
	const { queryClient } = renderTable();

	await startStatusLookup();
	const taskStream = await getTaskStream("task-mirror-status-1");
	taskStream.emit(taskChangedEventName, createMirrorStatusTask("task-mirror-status-1", "succeeded"));

	expect(await screen.findByText("1 of 2 snapshots are missing in this mirror.")).toBeTruthy();
	const queryKey = mirrorStatusQueryKey("backup-1", "mirror-1");
	await waitFor(() => {
		expect(queryClient.getQueryData(queryKey)).not.toBeUndefined();
	});
	await userEvent.keyboard("{Escape}");
	await queryClient.invalidateQueries();
	await startStatusLookup();

	expect(await screen.findByText("Checking snapshot status...")).toBeTruthy();
	expect(startRequests).toBe(2);
});

test("does not refresh an invalidated result when the dialog rerenders", async () => {
	let startRequests = 0;
	server.use(
		http.post("/api/v1/backups/backup-1/mirrors/mirror-1/status", () => {
			startRequests++;
			return HttpResponse.json({ taskId: "task-mirror-status", status: "started" }, { status: 202 });
		}),
	);
	const { queryClient, rerender } = renderTable();

	await startStatusLookup();
	const taskStream = await getTaskStream("task-mirror-status");
	taskStream.emit(taskChangedEventName, createMirrorStatusTask("task-mirror-status", "succeeded"));

	expect(await screen.findByText("1 of 2 snapshots are missing in this mirror.")).toBeTruthy();
	const queryKey = mirrorStatusQueryKey("backup-1", "mirror-1");
	await queryClient.invalidateQueries();
	rerender(createTable());

	expect(await screen.findByText("1 of 2 snapshots are missing in this mirror.")).toBeTruthy();
	expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
	expect(startRequests).toBe(1);
});

test("a closed lookup finishing its start request does not invalidate another mirror's cached result", async () => {
	const firstResponse = Promise.withResolvers<Response>();
	server.use(
		http.post("/api/v1/backups/backup-1/mirrors/mirror-1/status", () => firstResponse.promise),
		http.post("/api/v1/backups/backup-1/mirrors/mirror-2/status", () => {
			return HttpResponse.json({ taskId: "task-second-mirror", status: "started" }, { status: 202 });
		}),
	);
	const secondAssignments = new Map([
		[mirror.shortId, { repositoryId: mirror.shortId, enabled: true }],
		[secondMirror.shortId, { repositoryId: secondMirror.shortId, enabled: true }],
	]);
	const { queryClient } = renderTable({
		repositories: [mirror, secondMirror],
		assignments: secondAssignments,
	});
	const secondQueryKey = mirrorStatusQueryKey("backup-1", "mirror-2");
	const secondResult = createMirrorStatusResult("snapshot-2");
	const completedSecondTask = createMirrorStatusTask("task-second-mirror", "succeeded");
	const secondTask = { ...completedSecondTask, result: secondResult };
	await startStatusLookup(1);
	const secondStream = await getTaskStream("task-second-mirror");
	secondStream.emit(taskChangedEventName, secondTask);
	expect(await screen.findByText("snapshot-2")).toBeTruthy();
	await userEvent.keyboard("{Escape}");

	await startStatusLookup();
	expect(await screen.findByText("Checking snapshot status...")).toBeTruthy();
	await userEvent.keyboard("{Escape}");
	await startStatusLookup(1);

	expect(await screen.findByText("snapshot-2")).toBeTruthy();
	firstResponse.resolve(HttpResponse.json({ taskId: "task-mirror-status-1", status: "started" }, { status: 202 }));

	await waitFor(() => {
		const firstQueryKey = mirrorStatusQueryKey("backup-1", "mirror-1");
		expect(queryClient.getQueryData(firstQueryKey)).toMatchObject({ taskId: "task-mirror-status-1" });
	});
	expect(queryClient.getQueryState(secondQueryKey)?.isInvalidated).toBe(false);
	expect(screen.getByText("snapshot-2")).toBeTruthy();

	await userEvent.keyboard("{Escape}");
	await startStatusLookup();
	const firstStream = await getTaskStream("task-mirror-status-1");
	firstStream.emit(taskChangedEventName, createMirrorStatusTask("task-mirror-status-1", "succeeded"));
	expect(await screen.findByText("snapshot-1")).toBeTruthy();
	expect(screen.queryByText("snapshot-2")).toBeNull();
});

test.each(["failed", "cancelled", "stale"] as const)("does not reuse a %s snapshot lookup", async (status) => {
	let startRequests = 0;
	server.use(
		http.post("/api/v1/backups/backup-1/mirrors/mirror-1/status", () => {
			startRequests++;
			const taskId = `task-mirror-status-${startRequests}`;
			return HttpResponse.json({ taskId, status: "started" }, { status: 202 });
		}),
	);
	renderTable();

	await startStatusLookup();
	const taskStream = await getTaskStream("task-mirror-status-1");
	taskStream.emit(
		taskChangedEventName,
		createMirrorStatusTask("task-mirror-status-1", status, "Repository is locked."),
	);

	expect(await screen.findByRole("alert")).toBeTruthy();
	await userEvent.keyboard("{Escape}");
	await startStatusLookup();

	expect(await screen.findByText("Checking snapshot status...")).toBeTruthy();
	expect(startRequests).toBe(2);
});
