import { focusManager } from "@tanstack/react-query";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ListTaskHistoryResponse } from "~/client/api-client";
import { useServerEvents } from "~/client/hooks/use-server-events";
import { taskChangedEventName, tasksSnapshotEventName } from "~/schemas/task-events";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent, waitFor, within } from "~/test/test-utils";
import { TaskLogPage, formatTaskDuration, getTaskLogPagination } from "../task-log";

vi.mock("~/client/lib/datetime", () => ({
	useTimeFormat: () => ({
		formatDateTimeWithSeconds: (value: number) => new Date(value).toISOString(),
	}),
}));

type TaskLogItem = ListTaskHistoryResponse["items"][number];

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

	emit(type: string, data: unknown = {}) {
		for (const listener of this.listeners.get(type) ?? []) {
			listener(new MessageEvent(type, { data: JSON.stringify(data) }));
		}
	}

	close() {}
}

const originalEventSource = globalThis.EventSource;
const createdAt = Date.UTC(2026, 6, 13, 12, 0, 0);

const createItem = (overrides: Partial<TaskLogItem> = {}): TaskLogItem => ({
	id: "task-1",
	taskType: "Backup",
	outcome: "success",
	target: { label: "Nightly files", secondary: null, href: "/backups/nightly" },
	status: "succeeded",
	createdAt,
	startedAt: createdAt + 1_000,
	finishedAt: createdAt + 43_000,
	message: null,
	...overrides,
});

const historyPage = (
	items: TaskLogItem[],
	overrides: Partial<Omit<ListTaskHistoryResponse, "items">> = {},
): ListTaskHistoryResponse => ({
	items,
	page: 1,
	pageSize: 25,
	totalItems: items.length,
	totalPages: items.length > 0 ? 1 : 0,
	...overrides,
});

const renderPage = (overrides: Partial<React.ComponentProps<typeof TaskLogPage>> = {}) => {
	return render(
		<TaskLogPage page={1} onKindChange={vi.fn()} onOutcomeChange={vi.fn()} onPageChange={vi.fn()} {...overrides} />,
	);
};

const GlobalServerEvents = () => {
	useServerEvents();
	return null;
};

beforeEach(() => {
	MockEventSource.instances = [];
	globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
});

afterEach(() => {
	cleanup();
	focusManager.setFocused(undefined);
	globalThis.EventSource = originalEventSource;
	MockEventSource.instances = [];
});

describe("TaskLogPage", () => {
	test("renders restrained outcome indicators and bounds long task details inside a scrolling dialog", async () => {
		const fullMessage = Array.from(
			{ length: 80 },
			(_, index) => `Restore error ${index + 1}: the destination is read-only.`,
		).join("\n");
		const items: TaskLogItem[] = [
			createItem(),
			createItem({ id: "restore", taskType: "Restore", outcome: "running", status: "running", finishedAt: null }),
			createItem({ id: "delete", taskType: "Delete snapshots", outcome: "warning", message: "Warnings" }),
			createItem({ id: "tags", taskType: "Update snapshot tags", outcome: "cancelled", status: "cancelled" }),
			createItem({
				id: "legacy",
				outcome: null,
				target: { label: "No target", secondary: null, href: null },
			}),
			createItem({
				id: "doctor",
				taskType: "Repository doctor",
				outcome: "error",
				status: "succeeded",
				message: fullMessage,
				target: { label: "Archive vault", secondary: null, href: "/repositories/archive" },
			}),
			createItem({ id: "stale", outcome: "stale", status: "stale" }),
		];
		server.use(http.get("/api/v1/tasks/history", () => HttpResponse.json(historyPage(items))));

		renderPage();

		for (const label of ["Backup", "Restore", "Delete snapshots", "Update snapshot tags", "Repository doctor"]) {
			expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
		}
		for (const outcome of ["Running", "Success", "Warning", "Error", "Cancelled", "Stale", "Not recorded"]) {
			expect(screen.getAllByText(outcome).length).toBeGreaterThan(0);
		}
		const successIndicator = screen.getByText("Success").closest("span");
		expect(successIndicator?.className).toContain("inline-flex");
		expect(successIndicator?.className).not.toContain("rounded-full");
		expect(successIndicator?.className).not.toContain("bg-");
		for (const column of ["Task type", "Outcome", "Target", "Created", "Duration", "Details"]) {
			expect(screen.getByRole("columnheader", { name: column })).toBeTruthy();
		}

		await userEvent.click(
			screen.getByRole("button", {
				name: "View details for Repository doctor targeting Archive vault",
			}),
		);
		const dialog = screen.getByRole("dialog");
		expect(dialog.className).toContain("max-h-[calc(100dvh-2rem)]");
		const scrollRegion = dialog.querySelector(".overflow-y-auto");
		expect(scrollRegion).toBeTruthy();
		expect(scrollRegion?.className).toContain("min-h-0");
		expect(scrollRegion?.textContent).toContain("Restore error 1: the destination is read-only.");
		expect(scrollRegion?.textContent).toContain("Restore error 80: the destination is read-only.");
		expect(within(dialog).getByText("Archive vault")).toBeTruthy();
		for (const forbidden of ["Task ID", "Agent ID", "Raw JSON", "snapshotIds", "Data added", "Copy"]) {
			expect(within(dialog).queryByText(forbidden, { exact: false })).toBeNull();
		}
	});

	test("renders compact numbered pagination with URL-backed filter links", async () => {
		server.use(
			http.get("/api/v1/tasks/history", ({ request }) => {
				const page = Number(new URL(request.url).searchParams.get("page"));
				return HttpResponse.json(
					historyPage([createItem({ id: `task-${page}` })], {
						page,
						totalItems: 180,
						totalPages: 8,
					}),
				);
			}),
		);
		const onPageChange = vi.fn();
		renderPage({ page: 4, kind: "backup", outcome: "warning", onPageChange });

		expect(await screen.findByText("Showing 76–100 of 180")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Go to page 4" }).getAttribute("aria-current")).toBe("page");
		expect(screen.getByRole("link", { name: "Go to page 8" }).getAttribute("href")).toBe(
			"/task-log?kind=backup&outcome=warning&page=8",
		);
		expect(screen.getAllByText("More pages")).toHaveLength(2);

		await userEvent.click(screen.getByRole("link", { name: "Go to next page" }));
		expect(onPageChange).toHaveBeenCalledWith(5);
		await userEvent.click(screen.getByRole("link", { name: "Go to page 8" }));
		expect(onPageChange).toHaveBeenCalledWith(8);
	});

	test("keeps a historical page stable and offers to return to new activity", async () => {
		server.use(
			http.get("/api/v1/tasks/history", ({ request }) => {
				const page = Number(new URL(request.url).searchParams.get("page"));
				return HttpResponse.json(
					historyPage([createItem({ id: "older", taskType: "Repository doctor" })], {
						page,
						totalItems: 75,
						totalPages: 3,
					}),
				);
			}),
		);
		const onPageChange = vi.fn();
		const { rerender } = renderPage({ page: 2, onPageChange });
		expect(await screen.findByText("Repository doctor")).toBeTruthy();
		await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

		act(() => MockEventSource.instances[0]?.emit(taskChangedEventName));
		expect(await screen.findByRole("button", { name: "View latest activity" })).toBeTruthy();
		expect(screen.getByText("Repository doctor")).toBeTruthy();
		rerender(<TaskLogPage page={3} onKindChange={vi.fn()} onOutcomeChange={vi.fn()} onPageChange={onPageChange} />);
		expect(screen.getByRole("button", { name: "View latest activity" })).toBeTruthy();

		await userEvent.click(screen.getByRole("button", { name: "View latest activity" }));
		expect(onPageChange).toHaveBeenCalledWith(1);
	});

	test("clears stale activity when filters change", async () => {
		server.use(
			http.get("/api/v1/tasks/history", ({ request }) => {
				const page = Number(new URL(request.url).searchParams.get("page"));
				return HttpResponse.json(historyPage([createItem()], { page, totalItems: 50, totalPages: 2 }));
			}),
		);
		const callbacks = { onKindChange: vi.fn(), onOutcomeChange: vi.fn(), onPageChange: vi.fn() };
		const { rerender } = renderPage({ page: 2, ...callbacks });
		await screen.findByText("Nightly files");
		await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

		act(() => MockEventSource.instances[0]?.emit(taskChangedEventName));
		expect(await screen.findByRole("button", { name: "View latest activity" })).toBeTruthy();

		rerender(<TaskLogPage page={2} kind="backup" {...callbacks} />);
		expect(screen.queryByRole("button", { name: "View latest activity" })).toBeNull();
		rerender(<TaskLogPage page={2} {...callbacks} />);
		expect(screen.queryByRole("button", { name: "View latest activity" })).toBeNull();
	});

	test("keeps a historical page stable when the root event stream invalidates active queries", async () => {
		let requestCount = 0;
		server.use(
			http.get("/api/v1/tasks/history", () => {
				requestCount += 1;
				return HttpResponse.json(
					historyPage(
						[
							createItem({
								id: `history-${requestCount}`,
								taskType: requestCount === 1 ? "Repository doctor" : "Restore",
							}),
						],
						{ page: 2, totalItems: 30, totalPages: 2 },
					),
				);
			}),
		);

		render(
			<>
				<GlobalServerEvents />
				<TaskLogPage page={2} onKindChange={vi.fn()} onOutcomeChange={vi.fn()} onPageChange={vi.fn()} />
			</>,
		);
		expect(await screen.findByText("Repository doctor")).toBeTruthy();
		await waitFor(() => expect(MockEventSource.instances).toHaveLength(2));
		const globalEventSource = MockEventSource.instances.find((instance) => instance.url === "/api/v1/events");

		act(() =>
			globalEventSource?.emit("task:finished", {
				organizationId: "default-org",
				taskId: "doctor-task",
				kind: "doctor",
				resourceType: "repository",
				resourceId: "repo-short",
				status: "succeeded",
			}),
		);
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(requestCount).toBe(1);
		expect(screen.getByText("Repository doctor")).toBeTruthy();
		expect(screen.queryByText("Restore")).toBeNull();
	});

	test("manual refresh refetches the current numbered page", async () => {
		const requestedPages: string[] = [];
		server.use(
			http.get("/api/v1/tasks/history", ({ request }) => {
				requestedPages.push(new URL(request.url).searchParams.get("page") ?? "1");
				return HttpResponse.json(historyPage([createItem()], { page: 2, totalItems: 30, totalPages: 2 }));
			}),
		);

		renderPage({ page: 2 });
		await screen.findByText("Nightly files");
		await userEvent.click(screen.getByRole("button", { name: "Refresh task log" }));
		await waitFor(() => expect(requestedPages).toEqual(["2", "2"]));
	});

	test("refreshes a numbered page when returning to it", async () => {
		const visits = new Map<number, number>();
		server.use(
			http.get("/api/v1/tasks/history", ({ request }) => {
				const page = Number(new URL(request.url).searchParams.get("page"));
				const visit = (visits.get(page) ?? 0) + 1;
				visits.set(page, visit);
				return HttpResponse.json(
					historyPage(
						[
							createItem({
								id: `page-${page}-visit-${visit}`,
								target: { label: `Page ${page} visit ${visit}`, secondary: null, href: null },
							}),
						],
						{ page, totalItems: 75, totalPages: 3 },
					),
				);
			}),
		);
		const callbacks = { onKindChange: vi.fn(), onOutcomeChange: vi.fn(), onPageChange: vi.fn() };
		const { rerender } = renderPage({ page: 2, ...callbacks });
		expect(await screen.findByText("Page 2 visit 1")).toBeTruthy();

		rerender(<TaskLogPage page={3} {...callbacks} />);
		expect(await screen.findByText("Page 3 visit 1")).toBeTruthy();
		rerender(<TaskLogPage page={2} {...callbacks} />);

		expect(await screen.findByText("Page 2 visit 2")).toBeTruthy();
	});

	test("does not refetch a historical page when window focus returns", async () => {
		let requestCount = 0;
		server.use(
			http.get("/api/v1/tasks/history", () => {
				requestCount += 1;
				return HttpResponse.json(historyPage([createItem()], { page: 2, totalItems: 30, totalPages: 2 }));
			}),
		);

		renderPage({ page: 2 });
		await screen.findByText("Nightly files");
		act(() => {
			focusManager.setFocused(false);
			focusManager.setFocused(true);
		});
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(requestCount).toBe(1);
	});

	test("reconciles a visible running task that is absent from a reconnected active snapshot", async () => {
		let requestCount = 0;
		server.use(
			http.get("/api/v1/tasks/history", () => {
				requestCount += 1;
				const item =
					requestCount === 1
						? createItem({ outcome: "running", status: "running", finishedAt: null })
						: createItem();
				return HttpResponse.json(historyPage([item]));
			}),
		);

		renderPage();
		expect(await screen.findByText("Running")).toBeTruthy();
		await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
		act(() =>
			MockEventSource.instances[0]?.emit(tasksSnapshotEventName, [
				{
					id: "task-1",
					kind: "backup",
					status: "running",
					createdAt,
					startedAt: createdAt + 1_000,
					finishedAt: null,
				},
			]),
		);
		await new Promise((resolve) => setTimeout(resolve, 250));
		expect(requestCount).toBe(1);

		act(() => MockEventSource.instances[0]?.emit(tasksSnapshotEventName, []));
		expect(await screen.findByText("Success")).toBeTruthy();
		expect(requestCount).toBe(2);
	});

	test("updates an open details dialog when a running task reaches its terminal result", async () => {
		const finishedAt = createdAt + 43_000;
		let requestCount = 0;
		server.use(
			http.get("/api/v1/tasks/history", () => {
				requestCount += 1;
				const item =
					requestCount === 1
						? createItem({ outcome: "running", status: "running", finishedAt: null })
						: createItem({
								outcome: "error",
								status: "failed",
								finishedAt,
								message: "Backup repository became unavailable.",
								target: { label: "Renamed nightly files", secondary: null, href: null },
							});
				return HttpResponse.json(historyPage([item]));
			}),
		);

		renderPage();
		await userEvent.click(
			await screen.findByRole("button", { name: "View details for Backup targeting Nightly files" }),
		);
		const dialog = screen.getByRole("dialog");
		expect(within(dialog).getAllByText("Running")).toHaveLength(2);
		await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
		act(() => MockEventSource.instances[0]?.emit(tasksSnapshotEventName, []));

		expect(await within(dialog).findByText("Error")).toBeTruthy();
		expect(within(dialog).getByText("Failed")).toBeTruthy();
		expect(within(dialog).getByText("42s")).toBeTruthy();
		expect(within(dialog).getByText("Backup repository became unavailable.")).toBeTruthy();
		expect(within(dialog).getByText("Renamed nightly files")).toBeTruthy();
	});

	test("detects an active task created between the first-page request and stream connection", async () => {
		let requestCount = 0;
		server.use(
			http.get("/api/v1/tasks/history", () => {
				requestCount += 1;
				const items =
					requestCount === 1 ? [] : [createItem({ id: "new-active", outcome: "running", status: "queued" })];
				return HttpResponse.json(historyPage(items));
			}),
		);

		renderPage();
		expect(await screen.findByText("No task history yet")).toBeTruthy();
		await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
		act(() => MockEventSource.instances[0]?.emit(tasksSnapshotEventName, [{ id: "new-active" }]));

		expect(await screen.findByText("Nightly files")).toBeTruthy();
		expect(screen.getByText("Running")).toBeTruthy();
		expect(requestCount).toBe(2);
	});

	test("requests URL-backed filters and page, then reports filter changes", async () => {
		const onKindChange = vi.fn();
		const onOutcomeChange = vi.fn();
		let requestUrl = "";
		server.use(
			http.get("/api/v1/tasks/history", ({ request }) => {
				requestUrl = request.url;
				return HttpResponse.json(historyPage([], { page: 3 }));
			}),
		);

		renderPage({ page: 3, kind: "backup", outcome: "warning", onKindChange, onOutcomeChange });
		expect(await screen.findByText("No tasks match these filters")).toBeTruthy();
		const searchParams = new URL(requestUrl).searchParams;
		expect(searchParams.get("kind")).toBe("backup");
		expect(searchParams.get("outcome")).toBe("warning");
		expect(searchParams.get("page")).toBe("3");

		await userEvent.click(screen.getByRole("combobox", { name: "Task type" }));
		await userEvent.click(await screen.findByRole("option", { name: "Restore" }));
		expect(onKindChange).toHaveBeenCalledWith("restore");
		await userEvent.click(screen.getByRole("combobox", { name: "Outcome" }));
		await userEvent.click(await screen.findByRole("option", { name: "All outcomes" }));
		expect(onOutcomeChange).toHaveBeenCalledWith(undefined);
	});

	test("clamps a page that is beyond the filtered result set", async () => {
		server.use(
			http.get("/api/v1/tasks/history", () =>
				HttpResponse.json(historyPage([], { page: 7, totalItems: 60, totalPages: 3 })),
			),
		);
		const onPageChange = vi.fn();
		renderPage({ page: 7, onPageChange });

		await waitFor(() => expect(onPageChange).toHaveBeenCalledWith(3));
	});

	test("shows loading, empty, and recoverable error states", async () => {
		let resolveRequest: (() => void) | undefined;
		server.use(
			http.get("/api/v1/tasks/history", async () => {
				await new Promise<void>((resolve) => {
					resolveRequest = resolve;
				});
				return HttpResponse.json(historyPage([]));
			}),
		);

		renderPage();
		expect(screen.getByLabelText("Loading task history")).toBeTruthy();
		await waitFor(() => expect(resolveRequest).toEqual(expect.any(Function)));
		act(() => resolveRequest?.());
		expect(await screen.findByText("No task history yet")).toBeTruthy();

		cleanup();
		server.use(http.get("/api/v1/tasks/history", () => new HttpResponse(null, { status: 500 })));
		renderPage();
		expect(await screen.findByText("Could not load task history")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
	});
});

test.each([
	[1, 4, [1, 2, 3, 4]],
	[1, 8, [1, 2, 3, "ellipsis-end", 8]],
	[4, 8, [1, "ellipsis-start", 4, "ellipsis-end", 8]],
	[8, 8, [1, "ellipsis-start", 6, 7, 8]],
] as const)("builds compact pagination for page %s of %s", (page, totalPages, expected) => {
	expect(getTaskLogPagination(page, totalPages)).toEqual(expected);
});

test.each([
	[{ outcome: "success", createdAt: 0, startedAt: 1_000, finishedAt: 1_500 }, 9_999, "<1s"],
	[{ outcome: "success", createdAt: 0, startedAt: 1_000, finishedAt: 43_000 }, 9_999, "42s"],
	[{ outcome: "success", createdAt: 0, startedAt: 1_000, finishedAt: 193_000 }, 9_999, "3m 12s"],
	[{ outcome: "success", createdAt: 0, startedAt: 1_000, finishedAt: 4_081_000 }, 9_999, "1h 08m"],
	[{ outcome: "running", createdAt: 1_000, startedAt: null, finishedAt: null }, 43_000, "42s"],
] as const)("formats compact task duration", (item, now, expected) => {
	expect(formatTaskDuration(item, now)).toBe(expected);
});
