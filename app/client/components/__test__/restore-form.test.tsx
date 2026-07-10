import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { restoreTasksOptions } from "~/client/modules/repositories/restore-tasks";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, createTestQueryClient, render, screen, userEvent, waitFor, within } from "~/test/test-utils";
import { taskChangedEventName } from "~/schemas/task-events";
import type { TaskOfKind } from "~/client/hooks/use-active-tasks";
import type { Repository } from "~/client/lib/types";
import { fromAny } from "@total-typescript/shoehorn";
import { RestoreSnapshotPage } from "~/client/modules/repositories/routes/restore-snapshot";

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();

	return {
		...actual,
		useNavigate: (() => vi.fn(async () => {})) as typeof actual.useNavigate,
	};
});

import { RestoreForm } from "../restore-form";

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
const repositoryId = "repo-1";
const snapshotId = "snap-1";
type TaskResponse = TaskOfKind<"restore">;
type RestoreProgress = NonNullable<TaskResponse["progress"]>["progress"];
type RestoreResult = NonNullable<TaskResponse["result"]>;

const createRestoreTask = (
	options: {
		id?: string;
		snapshotId?: string;
		status?: TaskResponse["status"];
		progress?: RestoreProgress | null;
		result?: RestoreResult | null;
		error?: string | null;
		updatedAt?: number;
	} = {},
): TaskResponse => {
	const status = options.status ?? "running";
	const updatedAt = options.updatedAt ?? 1711411200000;
	const isTerminal = status === "cancelled" || status === "succeeded" || status === "failed" || status === "stale";

	return {
		id: options.id ?? "task-restore",
		kind: "restore",
		status,
		resourceType: "repository",
		resourceId: repositoryId,
		operationKey: options.snapshotId ?? snapshotId,
		targetAgentId: null,
		input: {
			kind: "restore",
			repositoryId,
			snapshotId: options.snapshotId ?? snapshotId,
			target: "/",
		},
		progress: options.progress ? { kind: "restore", progress: options.progress } : null,
		result: options.result ?? null,
		error: options.error ?? null,
		cancellationRequested: status === "cancelled",
		createdAt: 1711411200000,
		startedAt: 1711411200000,
		updatedAt,
		finishedAt: isTerminal ? updatedAt : null,
	};
};

const snapshotFilesHandler = http.get("/api/v1/repositories/:shortId/snapshots/:snapshotId/files", () => {
	return HttpResponse.json({
		files: [
			{ name: "project", path: "/mnt/project", type: "dir" },
			{ name: "a.txt", path: "/mnt/project/a.txt", type: "file" },
		],
	});
});

const renderRestoreForm = (queryClient = createTestQueryClient()) => {
	return render(
		<RestoreForm
			repository={fromAny({ shortId: repositoryId, name: "Repo 1" })}
			snapshotId={snapshotId}
			returnPath={`/repositories/${repositoryId}/${snapshotId}`}
			queryBasePath="/mnt/project"
			displayBasePath="/mnt"
		/>,
		{ queryClient },
	);
};

const renderRestoreFormWithPrefetchedTask = async (task: TaskResponse) => {
	server.use(
		http.get("/api/v1/tasks", () => HttpResponse.json([task])),
		snapshotFilesHandler,
	);
	const queryClient = createTestQueryClient();
	await queryClient.ensureQueryData(restoreTasksOptions(repositoryId, snapshotId));
	renderRestoreForm(queryClient);

	await waitFor(() => {
		expect(MockEventSource.instances).toHaveLength(1);
	});

	return MockEventSource.instances[0];
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

describe("RestoreForm", () => {
	test("recovers the active restore from the prefetched exact filtered collection", async () => {
		const taskStream = await renderRestoreFormWithPrefetchedTask(createRestoreTask());

		const restoreButton = await screen.findByRole("button", { name: "Restoring..." });
		expect(restoreButton.hasAttribute("disabled")).toBe(true);
		expect(screen.getByText("Restore in progress")).toBeTruthy();
		expect(taskStream?.url).toBe(
			"/api/v1/tasks/events?kind=restore&resourceType=repository&resourceId=repo-1&operationKey=snap-1",
		);
		expect(MockEventSource.instances).toHaveLength(1);
	});

	test("renders canonical task progress from the exact filtered stream", async () => {
		const activeRestore = createRestoreTask();
		const taskStream = await renderRestoreFormWithPrefetchedTask(activeRestore);

		taskStream?.emit(
			taskChangedEventName,
			createRestoreTask({
				progress: {
					message_type: "status",
					seconds_elapsed: 2,
					percent_done: 0.25,
					total_files: 4,
					files_restored: 1,
					total_bytes: 400,
					bytes_restored: 100,
				},
				updatedAt: activeRestore.updatedAt + 1,
			}),
		);

		expect(await screen.findByText("25%")).toBeTruthy();
		expect(screen.getByText("1 / 4")).toBeTruthy();
		expect(screen.getByText("2s")).toBeTruthy();
		expect(screen.getByText("50 B/s")).toBeTruthy();
		expect(MockEventSource.instances).toHaveLength(1);
	});

	test("keeps restoring feedback until the started task is reconciled", async () => {
		let resolveRestoreResponse: (response: Response) => void = () => {};
		const pendingRestoreResponse = new Promise<Response>((resolve) => {
			resolveRestoreResponse = resolve;
		});
		server.use(
			snapshotFilesHandler,
			http.post("/api/v1/repositories/:shortId/restore", () => pendingRestoreResponse),
		);
		const { queryClient } = renderRestoreForm();

		await userEvent.click(screen.getByRole("button", { name: "Restore All" }));

		const restoreButton = await screen.findByRole("button", { name: "Restoring..." });
		expect(restoreButton.hasAttribute("disabled")).toBe(true);
		expect(screen.getByText("Restore in progress")).toBeTruthy();

		resolveRestoreResponse(HttpResponse.json({ restoreId: "task-restore", status: "started" }, { status: 202 }));
		await waitFor(() => {
			expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe("success");
		});

		expect(screen.getByRole("button", { name: "Restoring..." }).hasAttribute("disabled")).toBe(true);
		expect(screen.queryByRole("button", { name: "Restore All" })).toBeNull();

		await waitFor(() => {
			expect(
				MockEventSource.instances.some(
					(eventSource) => eventSource.url === "/api/v1/tasks/task-restore/events",
				),
			).toBe(true);
		});
		MockEventSource.instances
			.find((eventSource) => eventSource.url === "/api/v1/tasks/task-restore/events")
			?.emit(taskChangedEventName, createRestoreTask());

		expect(await screen.findByRole("button", { name: "Restoring..." })).toBeTruthy();
	});

	test.each([
		{
			status: "succeeded" as const,
			result: {
				kind: "restore" as const,
				result: {
					message_type: "summary" as const,
					files_restored: 4,
					files_skipped: 0,
				},
			},
			error: null,
			title: "Restore completed",
			description: "Snapshot snap-1 was restored successfully.",
		},
		{
			status: "failed" as const,
			result: null,
			error: "Restic restore failed",
			title: "Restore failed",
			description: "Restic restore failed",
		},
		{
			status: "cancelled" as const,
			result: null,
			error: null,
			title: "Restore failed",
			description: "Snapshot snap-1 could not be restored.",
		},
		{
			status: "stale" as const,
			result: null,
			error: "Zerobyte was restarted before this task completed",
			title: "Restore failed",
			description: "Zerobyte was restarted before this task completed",
		},
	])(
		"clears restoring state and shows $status terminal feedback",
		async ({ status, result, error, title, description }) => {
			const activeRestore = createRestoreTask();
			const taskStream = await renderRestoreFormWithPrefetchedTask(activeRestore);

			taskStream?.emit(
				taskChangedEventName,
				createRestoreTask({
					status,
					result,
					error,
					updatedAt: activeRestore.updatedAt + 1,
				}),
			);

			expect(await screen.findByText(title)).toBeTruthy();
			expect(screen.getByText(description)).toBeTruthy();
			expect(screen.queryByText("Restore in progress")).toBeNull();

			await userEvent.click(screen.getByRole("button", { name: "OK" }));
			const restoreButton = await screen.findByRole("button", { name: "Restore All" });
			expect(restoreButton.hasAttribute("disabled")).toBe(false);
		},
	);

	test("resets restore lifecycle state when the repository snapshot scope changes", async () => {
		server.use(snapshotFilesHandler);
		const repository: Repository = fromAny({ shortId: repositoryId, name: "Repo 1" });
		const { rerender } = render(
			<RestoreSnapshotPage repository={repository} snapshotId="snap-1" returnPath="/repositories/repo-1" />,
		);
		const firstStreamUrl =
			"/api/v1/tasks/events?kind=restore&resourceType=repository&resourceId=repo-1&operationKey=snap-1";

		await waitFor(() => {
			expect(MockEventSource.instances.some(({ url }) => url === firstStreamUrl)).toBe(true);
		});
		const firstStream = MockEventSource.instances.find(({ url }) => url === firstStreamUrl);
		firstStream?.emit(taskChangedEventName, createRestoreTask());
		firstStream?.emit(taskChangedEventName, createRestoreTask({ status: "succeeded", updatedAt: 1711411200001 }));

		expect(await screen.findByText("Restore completed")).toBeTruthy();

		rerender(<RestoreSnapshotPage repository={repository} snapshotId="snap-2" returnPath="/repositories/repo-1" />);

		expect(screen.queryByText("Restore completed")).toBeNull();
		await waitFor(() => {
			expect(
				MockEventSource.instances.some(
					({ url }) =>
						url ===
						"/api/v1/tasks/events?kind=restore&resourceType=repository&resourceId=repo-1&operationKey=snap-2",
				),
			).toBe(true);
		});
	});

	test("restores the selected ancestor folder path from a broader display root", async () => {
		let restoreRequestBody: unknown;

		server.use(
			http.get("/api/v1/repositories/:shortId/snapshots/:snapshotId/files", () => {
				return HttpResponse.json({
					files: [
						{ name: "subdir", path: "/mnt/project/subdir", type: "dir" },
						{ name: "deep.tx", path: "/mnt/project/subdir/deep.tx", type: "file" },
					],
				});
			}),
			http.post("/api/v1/repositories/:shortId/restore", async ({ request }) => {
				restoreRequestBody = await request.json();
				return HttpResponse.json({
					success: true,
					message: "Snapshot restored successfully",
					filesRestored: 1,
					filesSkipped: 0,
				});
			}),
		);

		render(
			<RestoreForm
				repository={fromAny({ shortId: "repo-1", name: "Repo 1" })}
				snapshotId="snap-1"
				returnPath="/repositories/repo-1/snap-1"
				queryBasePath="/mnt/project/subdir"
				displayBasePath="/mnt"
			/>,
		);

		const row = await screen.findByRole("button", { name: "project" });
		await userEvent.click(within(row).getByRole("checkbox"));
		await userEvent.click(screen.getByRole("button", { name: "Restore 1 item" }));

		await waitFor(() => {
			expect(restoreRequestBody).toEqual({
				snapshotId: "snap-1",
				include: ["/mnt/project"],
				selectedItemKind: "dir",
				overwrite: "always",
			});
		});
	});

	test("restores the selected full path when the display root is unrelated", async () => {
		let restoreRequestBody: unknown;

		server.use(
			http.get("/api/v1/repositories/:shortId/snapshots/:snapshotId/files", () => {
				return HttpResponse.json({
					files: [
						{ name: "project", path: "/mnt/project", type: "dir" },
						{ name: "a.txt", path: "/mnt/project/a.txt", type: "file" },
					],
				});
			}),
			http.post("/api/v1/repositories/:shortId/restore", async ({ request }) => {
				restoreRequestBody = await request.json();
				return HttpResponse.json({
					success: true,
					message: "Snapshot restored successfully",
					filesRestored: 1,
					filesSkipped: 0,
				});
			}),
			http.get("/api/v1/volumes/filesystem/browse", () => {
				return HttpResponse.json({
					path: "/",
					directories: [{ name: "restore-target", path: "/restore-target", type: "dir" }],
				});
			}),
		);

		render(
			<RestoreForm
				repository={fromAny({ shortId: "repo-1", name: "Repo 1" })}
				snapshotId="snap-1"
				returnPath="/repositories/repo-1/snap-1"
				queryBasePath="/mnt/project"
				displayBasePath="/other/root"
			/>,
		);

		expect(
			screen.getByText(
				"This snapshot was created from source paths that do not match this Zerobyte server or the current linked volume. Restoring to the original location is unavailable. Restore it to a custom location, or download it instead.",
			),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Original location" }).hasAttribute("disabled")).toBe(true);
		expect(screen.getByRole("button", { name: "Restore All" }).hasAttribute("disabled")).toBe(true);

		await userEvent.click(screen.getByRole("button", { name: "Change" }));
		await userEvent.click(await screen.findByRole("button", { name: "restore-target" }));
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Restore All" }).hasAttribute("disabled")).toBe(false);
		});

		const row = await screen.findByRole("button", { name: "mnt" });
		await userEvent.click(within(row).getByRole("checkbox"));
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Restore 1 item" }).hasAttribute("disabled")).toBe(false);
		});

		await userEvent.click(screen.getByRole("button", { name: "Restore 1 item" }));

		await waitFor(() => {
			expect(restoreRequestBody).toEqual({
				snapshotId: "snap-1",
				include: ["/mnt"],
				selectedItemKind: "dir",
				targetPath: "/restore-target",
				overwrite: "always",
			});
		});
	});
});
