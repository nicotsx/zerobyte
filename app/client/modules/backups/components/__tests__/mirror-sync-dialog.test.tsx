import { fromPartial } from "@total-typescript/shoehorn";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Repository } from "~/client/lib/types";
import { taskChangedEventName } from "~/schemas/task-events";
import type { TaskDto, TaskStatus } from "~/schemas/tasks";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent, waitFor } from "~/test/test-utils";
import { MirrorSyncDialog } from "../mirror-sync-dialog";

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
		const event = new MessageEvent(type, { data: JSON.stringify(data) });
		const listeners = this.listeners.get(type) ?? [];

		for (const listener of listeners) {
			listener(event);
		}
	}

	close() {}

	static reset() {
		MockEventSource.instances = [];
	}
}

const originalEventSource = globalThis.EventSource;
const mirror = fromPartial<Repository>({ shortId: "mirror-1", name: "Mirror 1" });
type MirrorStatusResult = Extract<NonNullable<TaskDto["result"]>, { kind: "mirrorStatus" }>;

const createMirrorStatusTask = (
	options: {
		id?: string;
		status?: TaskStatus;
		result?: MirrorStatusResult | null;
		error?: string | null;
		updatedAt?: number;
	} = {},
): TaskDto => {
	const id = options.id ?? "task-mirror-status";
	const status = options.status ?? "running";
	const result = options.result ?? null;
	const error = options.error ?? null;
	const updatedAt = options.updatedAt ?? 1711411200000;
	const finished = status === "cancelled" || status === "succeeded" || status === "failed" || status === "stale";
	const finishedAt = finished ? updatedAt : null;
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
		updatedAt,
		finishedAt,
	};
};

const renderDialog = (
	options: {
		onClose?: () => void;
	} = {},
) => {
	const onClose = options.onClose ?? vi.fn();

	render(<MirrorSyncDialog scheduleShortId="backup-1" mirror={mirror} onClose={onClose} />);

	return { onClose };
};

const getTaskStream = async (taskId = "task-mirror-status") => {
	await waitFor(() => {
		expect(MockEventSource.instances.some((instance) => instance.url.endsWith(`/${taskId}/events`))).toBe(true);
	});

	const taskStream = MockEventSource.instances.find((instance) => instance.url.endsWith(`/${taskId}/events`));
	if (!taskStream) {
		throw new Error(`Expected task stream for ${taskId}`);
	}

	return taskStream;
};

beforeEach(() => {
	MockEventSource.reset();
	globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
	server.use(
		http.post("/api/v1/backups/backup-1/mirrors/mirror-1/status", () => {
			return HttpResponse.json({ taskId: "task-mirror-status", status: "started" }, { status: 202 });
		}),
	);
});

afterEach(() => {
	cleanup();
	globalThis.EventSource = originalEventSource;
	MockEventSource.reset();
});

test("shows progress while the snapshot-status task starts", () => {
	const startResponse = Promise.withResolvers<Response>();
	server.use(http.post("/api/v1/backups/backup-1/mirrors/mirror-1/status", () => startResponse.promise));
	renderDialog();

	expect(screen.getByText("Checking snapshot status...")).toBeTruthy();
});

test("renders missing snapshots from the completed task stream", async () => {
	renderDialog();
	const taskStream = await getTaskStream();
	const completedTask = createMirrorStatusTask({
		status: "succeeded",
		result: {
			kind: "mirrorStatus",
			sourceCount: 2,
			mirrorCount: 1,
			missingSnapshots: [{ short_id: "snapshot-1", time: "2026-03-26T00:00:00.000Z", size: 1024 }],
		},
	});

	taskStream?.emit(taskChangedEventName, completedTask);

	expect(await screen.findByText("1 of 2 snapshots are missing in this mirror.")).toBeTruthy();
	expect(screen.getByText("snapshot-1")).toBeTruthy();
});

test("offers a retry when the snapshot-status task fails", async () => {
	let startRequests = 0;
	server.use(
		http.post("/api/v1/backups/backup-1/mirrors/mirror-1/status", () => {
			startRequests++;
			const taskId = `task-mirror-status-${startRequests}`;
			return HttpResponse.json({ taskId, status: "started" }, { status: 202 });
		}),
	);
	renderDialog();
	const taskStream = await getTaskStream("task-mirror-status-1");
	const failedTask = createMirrorStatusTask({
		id: "task-mirror-status-1",
		status: "failed",
		error: "Repository is locked.",
	});

	taskStream?.emit(taskChangedEventName, failedTask);

	const alert = await screen.findByRole("alert");
	expect(alert.textContent).toBe("Repository is locked.");
	await userEvent.click(screen.getByRole("button", { name: "Retry" }));
	await getTaskStream("task-mirror-status-2");
	expect(startRequests).toBe(2);
});

test("offers a retry when the start request fails", async () => {
	server.use(
		http.post("/api/v1/backups/backup-1/mirrors/mirror-1/status", () => {
			return HttpResponse.json({ message: "Snapshot lookup is unavailable." }, { status: 503 });
		}),
	);
	renderDialog();

	const alert = await screen.findByRole("alert");
	expect(alert.textContent).toBe("Snapshot lookup is unavailable.");
	server.use(
		http.post("/api/v1/backups/backup-1/mirrors/mirror-1/status", () => {
			return HttpResponse.json({ taskId: "task-retried", status: "started" }, { status: 202 });
		}),
	);
	await userEvent.click(screen.getByRole("button", { name: "Retry" }));
	await getTaskStream("task-retried");
	expect(screen.getByText("Checking snapshot status...")).toBeTruthy();
});

test("offers a retry when the snapshot-status task is cancelled", async () => {
	let startRequests = 0;
	let cancelRequests = 0;
	server.use(
		http.post("/api/v1/backups/backup-1/mirrors/mirror-1/status", () => {
			startRequests++;
			const taskId = `task-mirror-status-${startRequests}`;
			return HttpResponse.json({ taskId, status: "started" }, { status: 202 });
		}),
		http.post("/api/v1/tasks/task-mirror-status-1/cancel", () => {
			cancelRequests++;
			return HttpResponse.json({ status: "cancelling" }, { status: 202 });
		}),
	);
	renderDialog();
	const taskStream = await getTaskStream("task-mirror-status-1");
	taskStream.emit(taskChangedEventName, createMirrorStatusTask({ id: "task-mirror-status-1", status: "running" }));
	await userEvent.click(screen.getByRole("button", { name: "Cancel lookup" }));
	expect(cancelRequests).toBe(1);
	const cancelledTask = createMirrorStatusTask({ id: "task-mirror-status-1", status: "cancelled" });

	taskStream?.emit(taskChangedEventName, cancelledTask);

	expect(await screen.findByText("Snapshot lookup was cancelled.")).toBeTruthy();
	await userEvent.click(screen.getByRole("button", { name: "Retry" }));
	await getTaskStream("task-mirror-status-2");
	expect(startRequests).toBe(2);
});

test("dismisses a pending lookup without requesting cancellation", async () => {
	let cancelledTaskId: string | null = null;
	server.use(
		http.post("/api/v1/tasks/:taskId/cancel", ({ params }) => {
			cancelledTaskId = String(params.taskId);
			return HttpResponse.json({ status: "cancelling" }, { status: 202 });
		}),
	);
	const onClose = vi.fn();
	renderDialog({ onClose });

	await userEvent.keyboard("{Escape}");

	expect(onClose).toHaveBeenCalledTimes(1);
	expect(cancelledTaskId).toBeNull();
});
