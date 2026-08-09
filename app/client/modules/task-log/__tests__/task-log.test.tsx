import { focusManager } from "@tanstack/react-query";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ListTaskHistoryResponse } from "~/client/api-client";
import { useServerEvents } from "~/client/hooks/use-server-events";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent, waitFor, within } from "~/test/test-utils";
import type { ServerEventPayloadMap } from "~/schemas/server-events";
import { TaskLogPage, getTaskLogPagination } from "../task-log";

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));

vi.mock("sonner", () => ({
	toast: {
		success: toastSuccess,
		error: vi.fn(),
	},
}));

vi.mock("~/client/lib/datetime", async (importOriginal) => {
	const datetime = await importOriginal<typeof import("~/client/lib/datetime")>();

	return {
		...datetime,
		useTimeFormat: () => ({
			formatDateTimeWithSeconds: (value: number) => new Date(value).toISOString(),
		}),
	};
});

type TaskLogItem = ListTaskHistoryResponse["items"][number];
type TaskHistoryChangedEvent = ServerEventPayloadMap["task:history-changed"];
type TaskHistoryChangedEventOverrides = Omit<Partial<TaskHistoryChangedEvent>, "item"> & {
	item?: Partial<TaskHistoryChangedEvent["item"]>;
};

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
const taskHistoryChangedEvent = "task:history-changed";

const createTaskHistoryChangedEvent = (overrides: TaskHistoryChangedEventOverrides = {}): TaskHistoryChangedEvent => {
	const { item: itemOverrides, ...eventOverrides } = overrides;
	const item = {
		id: "task-1",
		kind: "backup" as const,
		status: "succeeded" as const,
		outcome: "success" as const,
		startedAt: createdAt + 1_000,
		finishedAt: createdAt + 43_000,
		message: null,
		...itemOverrides,
	};

	return {
		organizationId: "default-org",
		previousOutcome: null,
		item,
		...eventOverrides,
	};
};

const createItem = (overrides: Partial<TaskLogItem> = {}): TaskLogItem => ({
	id: "task-1",
	kind: "backup",
	outcome: "success",
	target: {
		kind: "backupSchedule",
		label: "Nightly files",
		secondary: null,
		scheduleShortId: "nightly",
	},
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
	organizationId: "default-org",
	items,
	page: 1,
	pageSize: 25,
	totalItems: items.length,
	totalPages: items.length > 0 ? 1 : 0,
	...overrides,
});

const renderPage = (overrides: Partial<React.ComponentProps<typeof TaskLogPage>> = {}) => {
	return render(
		<TaskLogPage
			organizationId="default-org"
			page={1}
			onKindChange={vi.fn()}
			onOutcomeChange={vi.fn()}
			onPageChange={vi.fn()}
			{...overrides}
		/>,
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
			createItem({
				id: "restore",
				kind: "restore",
				outcome: "running",
				status: "running",
				finishedAt: null,
			}),
			createItem({
				id: "delete",
				kind: "deleteSnapshots",
				outcome: "warning",
				message: "Warnings",
			}),
			createItem({
				id: "tags",
				kind: "tagSnapshots",
				outcome: "cancelled",
				status: "cancelled",
			}),
			createItem({
				id: "unlinked",
				outcome: null,
				target: { kind: "unavailable", label: "Unlinked schedule", secondary: null },
			}),
			createItem({
				id: "doctor",
				kind: "doctor",
				outcome: "error",
				status: "succeeded",
				message: fullMessage,
				target: {
					kind: "repository",
					label: "Archive vault",
					secondary: null,
					repositoryShortId: "archive",
					snapshotId: null,
				},
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

	test("preserves durations longer than a calendar month", async () => {
		const thirtyOneDaysInSeconds = 31 * 24 * 60 * 60;
		const finishedAt = createdAt + thirtyOneDaysInSeconds * 1000;
		const item = createItem({ startedAt: createdAt, finishedAt });
		server.use(http.get("/api/v1/tasks/history", () => HttpResponse.json(historyPage([item]))));

		renderPage();

		expect(await screen.findByText("31d")).toBeTruthy();
	});

	test("fetches activity for a newly active organization without reusing previous loader data", async () => {
		let requestCount = 0;
		server.use(
			http.get("/api/v1/tasks/history", () => {
				requestCount += 1;
				const organizationLabel = requestCount === 1 ? "First organization" : "Second organization";
				const organizationId = requestCount === 1 ? "org-one" : "org-two";
				const target = { kind: "unavailable" as const, label: organizationLabel, secondary: null };

				return HttpResponse.json(historyPage([createItem({ target })], { organizationId }));
			}),
		);
		const initialTarget = { kind: "unavailable" as const, label: "Loader organization", secondary: null };
		const initialData = historyPage([createItem({ target: initialTarget })], { organizationId: "org-one" });
		const callbacks = {
			onKindChange: vi.fn(),
			onOutcomeChange: vi.fn(),
			onPageChange: vi.fn(),
		};
		const { rerender } = renderPage({
			initialData,
			organizationId: "org-one",
			...callbacks,
		});

		expect(screen.getByText("Loader organization")).toBeTruthy();
		expect(await screen.findByText("First organization")).toBeTruthy();
		rerender(<TaskLogPage initialData={initialData} organizationId="org-two" page={1} {...callbacks} />);

		expect(await screen.findByText("Second organization")).toBeTruthy();
		expect(screen.queryByText("Loader organization")).toBeNull();
		expect(requestCount).toBe(2);
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
			"/activity?kind=backup&outcome=warning&page=8",
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
					historyPage([createItem({ id: "older", kind: "doctor" })], {
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
		expect(screen.getByRole("button", { name: "View latest activity" })).toBeTruthy();
		expect(screen.getByText("Repository doctor")).toBeTruthy();
		rerender(
			<TaskLogPage
				organizationId="default-org"
				page={3}
				onKindChange={vi.fn()}
				onOutcomeChange={vi.fn()}
				onPageChange={onPageChange}
			/>,
		);
		expect(screen.getByRole("button", { name: "View latest activity" })).toBeTruthy();

		await userEvent.click(screen.getByRole("button", { name: "View latest activity" }));
		expect(onPageChange).toHaveBeenCalledWith(1);
	});

	test("refreshes loader data after installing live-update subscriptions", async () => {
		let requestCount = 0;
		server.use(
			http.get("/api/v1/tasks/history", () => {
				requestCount += 1;
				return HttpResponse.json(historyPage([createItem({ kind: "restore" })]));
			}),
		);

		const initialData = historyPage([createItem({ kind: "doctor" })]);
		renderPage({ initialData });

		expect(screen.getByText("Repository doctor")).toBeTruthy();
		expect(await screen.findByText("Restore")).toBeTruthy();
		expect(requestCount).toBe(1);
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
								kind: requestCount === 1 ? "doctor" : "restore",
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
				<TaskLogPage
					organizationId="default-org"
					page={2}
					onKindChange={vi.fn()}
					onOutcomeChange={vi.fn()}
					onPageChange={vi.fn()}
				/>
			</>,
		);
		expect(await screen.findByText("Repository doctor")).toBeTruthy();
		await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
		const globalEventSource = MockEventSource.instances.find((instance) => instance.url === "/api/v1/events");

		act(() =>
			globalEventSource?.emit(
				taskHistoryChangedEvent,
				createTaskHistoryChangedEvent({
					organizationId: "default-org",
					previousOutcome: "running",
					item: { id: "doctor-task", kind: "doctor", outcome: "success" },
				}),
			),
		);
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(requestCount).toBe(1);
		expect(screen.getByText("Repository doctor")).toBeTruthy();
		expect(screen.queryByText("Restore")).toBeNull();
	});

	test("keeps historical activity stable when the stream connects", async () => {
		let requestCount = 0;
		server.use(
			http.get("/api/v1/tasks/history", () => {
				requestCount += 1;
				return HttpResponse.json(
					historyPage([createItem({ kind: "doctor" })], {
						page: 2,
						totalItems: 30,
						totalPages: 2,
					}),
				);
			}),
		);

		renderPage({ page: 2 });
		expect(await screen.findByText("Repository doctor")).toBeTruthy();
		await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

		act(() => MockEventSource.instances[0]?.emit("connected", { type: "connected", timestamp: 1 }));
		expect(await screen.findByRole("button", { name: "View latest activity" })).toBeTruthy();
		expect(requestCount).toBe(1);
		expect(screen.getByText("Repository doctor")).toBeTruthy();
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
		await userEvent.click(screen.getByRole("button", { name: "Refresh activity" }));
		await waitFor(() => expect(requestedPages).toEqual(["2", "2"]));
		expect(toastSuccess).toHaveBeenCalledWith("Activity refreshed");
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
								target: {
									kind: "unavailable",
									label: `Page ${page} visit ${visit}`,
									secondary: null,
								},
							}),
						],
						{ page, totalItems: 75, totalPages: 3 },
					),
				);
			}),
		);
		const callbacks = {
			onKindChange: vi.fn(),
			onOutcomeChange: vi.fn(),
			onPageChange: vi.fn(),
		};
		const { rerender } = renderPage({ page: 2, ...callbacks });
		expect(await screen.findByText("Page 2 visit 1")).toBeTruthy();

		rerender(<TaskLogPage organizationId="default-org" page={3} {...callbacks} />);
		expect(await screen.findByText("Page 3 visit 1")).toBeTruthy();
		rerender(<TaskLogPage organizationId="default-org" page={2} {...callbacks} />);

		expect(await screen.findByText("Page 2 visit 2")).toBeTruthy();
	});

	test("refreshes a visible running task when its history outcome changes", async () => {
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
			MockEventSource.instances[0]?.emit(
				taskHistoryChangedEvent,
				createTaskHistoryChangedEvent({
					previousOutcome: "running",
					item: { kind: "backup", outcome: "success" },
				}),
			),
		);
		expect(await screen.findByText("Success")).toBeTruthy();
		expect(requestCount).toBe(2);
	});

	test("updates a visible running task on a historical page without refetching", async () => {
		let requestCount = 0;
		server.use(
			http.get("/api/v1/tasks/history", () => {
				requestCount += 1;
				const item =
					requestCount === 1
						? createItem({
								id: "active-on-page-2",
								outcome: "running",
								status: "running",
								finishedAt: null,
							})
						: createItem({ id: "active-on-page-2" });
				return HttpResponse.json(historyPage([item], { page: 2, totalItems: 30, totalPages: 2 }));
			}),
		);

		renderPage({ page: 2 });
		expect(await screen.findByText("Running")).toBeTruthy();
		await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
		act(() =>
			MockEventSource.instances[0]?.emit(
				taskHistoryChangedEvent,
				createTaskHistoryChangedEvent({
					organizationId: "default-org",
					previousOutcome: "running",
					item: {
						id: "active-on-page-2",
						kind: "backup",
						status: "succeeded",
						outcome: "success",
						startedAt: createdAt + 1_000,
						finishedAt: createdAt + 43_000,
						message: null,
					},
				}),
			),
		);

		expect(await screen.findByText("Success")).toBeTruthy();
		expect(screen.getByRole("button", { name: "View latest activity" })).toBeTruthy();
		expect(requestCount).toBe(1);
	});

	test("updates a visible historical task without replacing the page rows after newer activity shifts the offset", async () => {
		let requestCount = 0;
		const activeTask = createItem({
			id: "active-on-page-2",
			outcome: "running",
			status: "running",
			finishedAt: null,
			target: { kind: "unavailable", label: "Active backup", secondary: null },
		});
		const retainedTask = createItem({
			id: "retained-on-page-2",
			target: { kind: "unavailable", label: "Retained task", secondary: null },
		});
		const newerTask = createItem({
			id: "newer-task",
			target: { kind: "unavailable", label: "Newer task", secondary: null },
		});
		const initialHistory = historyPage([activeTask, retainedTask], {
			page: 2,
			totalItems: 51,
			totalPages: 3,
		});
		const shiftedHistory = historyPage([newerTask, retainedTask], {
			page: 2,
			totalItems: 52,
			totalPages: 3,
		});
		server.use(
			http.get("/api/v1/tasks/history", () => {
				requestCount += 1;
				return HttpResponse.json(requestCount === 1 ? initialHistory : shiftedHistory);
			}),
		);

		renderPage({ page: 2, initialData: initialHistory });
		expect(await screen.findByText("Running")).toBeTruthy();
		await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

		act(() =>
			MockEventSource.instances[0]?.emit(
				taskHistoryChangedEvent,
				createTaskHistoryChangedEvent({
					organizationId: "default-org",
					previousOutcome: "running",
					item: {
						id: activeTask.id,
						kind: "backup",
						status: "succeeded",
						outcome: "success",
						startedAt: createdAt + 1_000,
						finishedAt: createdAt + 43_000,
						message: null,
					},
				}),
			),
		);

		await waitFor(() => expect(screen.getAllByRole("row")[1]?.textContent).toContain("Success"));
		const rows = screen.getAllByRole("row");
		expect(rows).toHaveLength(3);
		expect(rows[1]?.textContent).toContain("Active backup");
		expect(rows[1]?.textContent).toContain("Success");
		expect(rows[2]?.textContent).toContain("Retained task");
		expect(screen.queryByText("Newer task")).toBeNull();
		expect(screen.getByRole("button", { name: "View latest activity" })).toBeTruthy();
		expect(requestCount).toBe(0);
	});

	test("does not refresh a historical page when an event targets a different task", async () => {
		let requestCount = 0;
		server.use(
			http.get("/api/v1/tasks/history", () => {
				requestCount += 1;
				const item = createItem({
					id: "active-on-page-2",
					outcome: "running",
					status: "running",
					finishedAt: null,
				});
				return HttpResponse.json(historyPage([item], { page: 2, totalItems: 30, totalPages: 2 }));
			}),
		);

		renderPage({ page: 2 });
		expect(await screen.findByText("Running")).toBeTruthy();
		await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
		act(() =>
			MockEventSource.instances[0]?.emit(
				taskHistoryChangedEvent,
				createTaskHistoryChangedEvent({
					organizationId: "default-org",
					previousOutcome: "running",
					item: { id: "another-task", kind: "backup", outcome: "success" },
				}),
			),
		);
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(screen.getByRole("button", { name: "View latest activity" })).toBeTruthy();
		expect(screen.getByText("Running")).toBeTruthy();
		expect(requestCount).toBe(1);
	});

	test("does not refresh the first page for task changes outside its filters", async () => {
		let requestCount = 0;
		server.use(
			http.get("/api/v1/tasks/history", () => {
				requestCount += 1;
				return HttpResponse.json(historyPage([createItem({ outcome: "warning" })]));
			}),
		);

		renderPage({ outcome: "warning" });
		expect(await screen.findByText("Warning")).toBeTruthy();
		await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
		act(() =>
			MockEventSource.instances[0]?.emit(
				taskHistoryChangedEvent,
				createTaskHistoryChangedEvent({
					previousOutcome: null,
					item: { kind: "backup", outcome: "success" },
				}),
			),
		);
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(requestCount).toBe(1);
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
								target: {
									kind: "unavailable",
									label: "Renamed nightly files",
									secondary: null,
								},
							});
				return HttpResponse.json(historyPage([item]));
			}),
		);

		renderPage();
		await userEvent.click(
			await screen.findByRole("button", {
				name: "View details for Backup targeting Nightly files",
			}),
		);
		const dialog = screen.getByRole("dialog");
		expect(within(dialog).getByText("Running")).toBeTruthy();
		expect(within(dialog).getByText("running")).toBeTruthy();
		await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
		act(() =>
			MockEventSource.instances[0]?.emit(
				taskHistoryChangedEvent,
				createTaskHistoryChangedEvent({
					previousOutcome: "running",
					item: {
						kind: "backup",
						status: "failed",
						outcome: "error",
						finishedAt: createdAt + 43_000,
						message: "Backup repository became unavailable.",
					},
				}),
			),
		);

		expect(await within(dialog).findByText("Error")).toBeTruthy();
		expect(within(dialog).getByText("failed")).toBeTruthy();
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
		act(() =>
			MockEventSource.instances[0]?.emit(
				taskHistoryChangedEvent,
				createTaskHistoryChangedEvent({
					previousOutcome: null,
					item: {
						kind: "backup",
						status: "queued",
						outcome: "running",
						finishedAt: null,
						message: null,
					},
				}),
			),
		);

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

	test("keeps cached history visible when a refresh fails", async () => {
		let requestCount = 0;
		server.use(
			http.get("/api/v1/tasks/history", () => {
				requestCount += 1;
				return new HttpResponse(null, { status: 500 });
			}),
		);
		const initialData = historyPage([
			createItem({ target: { kind: "unavailable", label: "Cached task", secondary: null } }),
		]);

		renderPage({ initialData });
		expect(screen.getByText("Cached task")).toBeTruthy();
		await waitFor(() => expect(requestCount).toBe(1));
		expect(screen.getByText("Cached task")).toBeTruthy();
		expect(screen.queryByText("Could not load task history")).toBeNull();
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
