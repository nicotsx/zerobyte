import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fromAny } from "@total-typescript/shoehorn";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent, waitFor } from "~/test/test-utils";
import { taskChangedEventName, tasksSnapshotEventName } from "~/schemas/task-events";

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();

	return {
		...actual,
		Link: (({ children }: { children?: ReactNode }) => <a href="/">{children}</a>) as typeof actual.Link,
		useNavigate: (() => vi.fn(async () => {})) as typeof actual.useNavigate,
		useSearch: (() => ({})) as typeof actual.useSearch,
	};
});

vi.mock("~/client/lib/datetime", async (importOriginal) => {
	const actual = await importOriginal<typeof import("~/client/lib/datetime")>();

	return {
		...actual,
		useTimeFormat: () => ({
			...actual.useTimeFormat(),
			formatDateTime: () => "2026-03-26 00:00",
		}),
	};
});

vi.mock("~/client/modules/backups/components/schedule-notifications-config", () => ({
	ScheduleNotificationsConfig: () => null,
}));

vi.mock("~/client/modules/backups/components/schedule-mirrors-config", () => ({
	ScheduleMirrorsConfig: () => null,
}));

vi.mock("~/client/modules/backups/components/schedule-summary", () => ({
	ScheduleSummary: ({ schedule }: { schedule: { name: string } }) => (
		<div>
			<h1>{schedule.name}</h1>
			<button type="button">Backup now</button>
		</div>
	),
}));

import { ScheduleDetailsPage } from "../backup-details";

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

const getDeleteTasksEventSource = () => {
	const expectedUrl = "/api/v1/tasks/events?kind=deleteSnapshots&resourceType=repository&resourceId=repo-1";
	return MockEventSource.instances.find((instance) => instance.url === expectedUrl);
};

const originalEventSource = globalThis.EventSource;

const schedule = {
	shortId: "backup-1",
	name: "Backup 1",
	repositoryId: "repo-1",
	repository: { shortId: "repo-1", name: "Repo 1" },
	volume: {
		shortId: "vol-1",
		name: "Volume 1",
		config: { backend: "directory", path: "/mnt" },
	},
	enabled: true,
	cronExpression: "0 0 * * *",
	retentionPolicy: null,
	lastBackupAt: 1711411200000,
	nextBackupAt: 1711497600000,
	lastBackupStatus: null,
	lastBackupError: null,
	includePaths: ["/project"],
	includePatterns: [],
	excludePatterns: [],
	excludeIfPresent: [],
	oneFileSystem: false,
	customResticParams: [],
	backupWebhooks: null,
};

const snapshot = {
	short_id: "snap-1",
	paths: ["/mnt/project"],
	tags: ["backup-1"],
	time: new Date("2026-03-26T00:00:00.000Z").getTime(),
	size: 2097152,
	duration: 12,
	retentionCategories: [],
	summary: {
		files_new: 10,
		files_changed: 5,
		files_unmodified: 85,
		dirs_new: 2,
		dirs_changed: 1,
		dirs_unmodified: 17,
		data_blobs: 20,
		tree_blobs: 5,
		data_added: 1048576,
		data_added_packed: 524288,
		total_files_processed: 100,
		total_bytes_processed: 2097152,
		backup_start: "2026-03-26T00:00:00.000Z",
		backup_end: "2026-03-26T00:00:12.000Z",
	},
};

const deleteSnapshotsTask = {
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

const mockScheduleDetailsRequests = (
	options: {
		scheduleOverride?: Record<string, unknown>;
		onScheduleRequest?: () => void;
		snapshots?: () => Array<typeof snapshot>;
		tasks?: () => Array<typeof deleteSnapshotsTask>;
	} = {},
) => {
	server.use(
		http.get("/api/v1/backups/:shortId", () => {
			options.onScheduleRequest?.();
			return HttpResponse.json({ ...schedule, ...options.scheduleOverride });
		}),
		http.get("/api/v1/repositories/:shortId/snapshots", () => {
			return HttpResponse.json(options.snapshots ? options.snapshots() : [snapshot]);
		}),
		http.delete("/api/v1/repositories/:shortId/snapshots/:snapshotId", () => {
			return HttpResponse.json({ taskId: "task-delete", status: "started" }, { status: 202 });
		}),
		http.get(/\/api\/v1\/tasks(?:\?.*)?$/, () => {
			return HttpResponse.json(options.tasks ? options.tasks() : []);
		}),
		http.get("/api/v1/repositories/:shortId/snapshots/:snapshotId/files", () => {
			return HttpResponse.json({
				files: [
					{ name: "project", path: "/mnt/project", type: "dir" },
					{ name: "a.txt", path: "/mnt/project/a.txt", type: "file" },
				],
			});
		}),
		http.get("/api/v1/backups/:shortId/progress", () => {
			return HttpResponse.json(null);
		}),
		http.get("/api/v1/backups/:shortId/notifications", () => {
			return HttpResponse.json([]);
		}),
		http.get("/api/v1/backups/:shortId/mirrors", () => {
			return HttpResponse.json([]);
		}),
		http.get("/api/v1/backups/:shortId/mirrors/compatibility", () => {
			return HttpResponse.json([]);
		}),
	);
};

beforeEach(() => {
	MockEventSource.reset();
	globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
});

afterEach(() => {
	globalThis.EventSource = originalEventSource;
	cleanup();
	MockEventSource.reset();
});

describe("ScheduleDetailsPage", () => {
	test("renders the real schedule details page with the selected snapshot", async () => {
		mockScheduleDetailsRequests();

		render(
			<ScheduleDetailsPage
				loaderData={fromAny({
					schedule,
					notifs: [],
					repos: [],
					scheduleNotifs: [],
					mirrors: [],
					snapshotTimelineSortOrder: "desc",
					snapshots: [snapshot],
				})}
				scheduleId="backup-1"
				initialSnapshotId="snap-1"
				initialSnapshotSortOrder="desc"
			/>,
			{ withSuspense: true },
		);

		expect(await screen.findByRole("heading", { name: "Backup 1" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Backup now" })).toBeTruthy();
		expect(screen.getByText("Snapshots")).toBeTruthy();
		expect(screen.getByText("Files processed")).toBeTruthy();
		expect(screen.getByRole("link", { name: /restore/i })).toBeTruthy();
		expect(await screen.findByRole("button", { name: "project" })).toBeTruthy();
	});

	test("shows snapshot loading state instead of empty state while an empty snapshot list refetches", async () => {
		let resolveSnapshots: () => void = () => {};
		const snapshotsResponse = new Promise<Response>((resolve) => {
			resolveSnapshots = () => resolve(HttpResponse.json([snapshot]));
		});

		server.use(
			http.get("/api/v1/backups/:shortId", () => HttpResponse.json(schedule)),
			http.get(/\/api\/v1\/tasks(?:\?.*)?$/, () => HttpResponse.json([])),
			http.get("/api/v1/repositories/:shortId/snapshots", () => snapshotsResponse),
			http.get("/api/v1/backups/:shortId/progress", () => HttpResponse.json(null)),
		);

		render(
			<ScheduleDetailsPage
				loaderData={fromAny({
					schedule,
					notifs: [],
					repos: [],
					scheduleNotifs: [],
					mirrors: [],
					snapshotTimelineSortOrder: "desc",
					snapshots: [],
				})}
				scheduleId="backup-1"
				initialSnapshotSortOrder="desc"
			/>,
			{ withSuspense: true },
		);

		expect(await screen.findByText("Loading snapshots...")).toBeTruthy();
		expect(screen.queryByText("No snapshots available")).toBeNull();
		resolveSnapshots();
		expect(await screen.findByText("Snapshots")).toBeTruthy();
	});

	test("polls the schedule only while a backup is running", async () => {
		let idleScheduleRequests = 0;

		mockScheduleDetailsRequests({
			onScheduleRequest: () => {
				idleScheduleRequests += 1;
			},
		});

		render(
			<ScheduleDetailsPage
				loaderData={fromAny({
					schedule,
					notifs: [],
					repos: [],
					scheduleNotifs: [],
					mirrors: [],
					snapshotTimelineSortOrder: "desc",
					snapshots: [snapshot],
				})}
				scheduleId="backup-1"
				initialSnapshotSortOrder="desc"
			/>,
			{ withSuspense: true },
		);

		expect(await screen.findByRole("heading", { name: "Backup 1" })).toBeTruthy();
		await new Promise((resolve) => setTimeout(resolve, 1200));
		expect(idleScheduleRequests).toBe(1);

		cleanup();

		let runningScheduleRequests = 0;

		mockScheduleDetailsRequests({
			scheduleOverride: { lastBackupStatus: "in_progress" },
			onScheduleRequest: () => {
				runningScheduleRequests += 1;
			},
		});

		render(
			<ScheduleDetailsPage
				loaderData={fromAny({
					schedule: fromAny({ ...schedule, lastBackupStatus: "in_progress" }),
					notifs: [],
					repos: [],
					scheduleNotifs: [],
					mirrors: [],
					snapshotTimelineSortOrder: "desc",
					snapshots: [snapshot],
				})}
				scheduleId="backup-1"
				initialSnapshotSortOrder="desc"
			/>,
			{ withSuspense: true },
		);

		expect(await screen.findByRole("heading", { name: "Backup 1" })).toBeTruthy();
		await new Promise((resolve) => setTimeout(resolve, 1200));
		expect(runningScheduleRequests).toBeGreaterThan(1);
	});

	test("shows deleting state for an active snapshot delete task", async () => {
		mockScheduleDetailsRequests();

		render(
			<ScheduleDetailsPage
				loaderData={fromAny({
					schedule,
					notifs: [],
					repos: [],
					scheduleNotifs: [],
					mirrors: [],
					snapshotTimelineSortOrder: "desc",
					snapshots: [snapshot],
				})}
				scheduleId="backup-1"
				initialSnapshotId="snap-1"
				initialSnapshotSortOrder="desc"
			/>,
			{ withSuspense: true },
		);

		await waitFor(() => {
			expect(getDeleteTasksEventSource()).not.toBeUndefined();
		});
		getDeleteTasksEventSource()?.emit(tasksSnapshotEventName, [deleteSnapshotsTask]);

		const deleteButton = await screen.findByRole("button", { name: /Deleting\.\.\./ });
		expect(await screen.findByText("Deleting")).toBeTruthy();
		expect((deleteButton as HTMLButtonElement).disabled).toBe(true);
	});

	test("removes deleted snapshot after the started delete task completes", async () => {
		mockScheduleDetailsRequests();

		render(
			<ScheduleDetailsPage
				loaderData={fromAny({
					schedule,
					notifs: [],
					repos: [],
					scheduleNotifs: [],
					mirrors: [],
					snapshotTimelineSortOrder: "desc",
					snapshots: [snapshot],
				})}
				scheduleId="backup-1"
				initialSnapshotId="snap-1"
				initialSnapshotSortOrder="desc"
			/>,
			{ withSuspense: true },
		);

		await screen.findByText("File Browser");

		await userEvent.click(await screen.findByRole("button", { name: "Delete Snapshot" }));
		await userEvent.click(await screen.findByRole("button", { name: "Delete snapshot" }));

		await waitFor(() => {
			expect(getDeleteTasksEventSource()).not.toBeUndefined();
		});
		const taskDeleteEventSource = getDeleteTasksEventSource();

		taskDeleteEventSource?.emit(taskChangedEventName, {
			...deleteSnapshotsTask,
			status: "succeeded",
			result: { kind: "deleteSnapshots", deletedSnapshotIds: ["snap-1"] },
			updatedAt: 1711411201000,
			finishedAt: 1711411201000,
		});

		await waitFor(() => {
			expect(screen.queryByText("File Browser")).toBeNull();
		});
	});

	test("removes deleted snapshot when a reconnect snapshot omits the cached active task", async () => {
		mockScheduleDetailsRequests();
		server.use(
			http.get("/api/v1/tasks/:taskId", () => {
				return HttpResponse.json({
					...deleteSnapshotsTask,
					status: "succeeded",
					result: { kind: "deleteSnapshots", deletedSnapshotIds: ["snap-1"] },
					updatedAt: 1711411201000,
					finishedAt: 1711411201000,
				});
			}),
		);

		render(
			<ScheduleDetailsPage
				loaderData={fromAny({
					schedule,
					notifs: [],
					repos: [],
					scheduleNotifs: [],
					mirrors: [],
					snapshotTimelineSortOrder: "desc",
					snapshots: [snapshot],
				})}
				scheduleId="backup-1"
				initialSnapshotId="snap-1"
				initialSnapshotSortOrder="desc"
			/>,
			{ withSuspense: true },
		);

		await screen.findByText("File Browser");

		await waitFor(() => {
			expect(getDeleteTasksEventSource()).not.toBeUndefined();
		});
		const taskDeleteEventSource = getDeleteTasksEventSource();
		taskDeleteEventSource?.emit(tasksSnapshotEventName, [deleteSnapshotsTask]);
		taskDeleteEventSource?.emit(tasksSnapshotEventName, []);

		await waitFor(() => {
			expect(screen.queryByText("File Browser")).toBeNull();
		});
	});
});
