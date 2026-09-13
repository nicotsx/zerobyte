import { afterEach, expect, test, vi } from "vitest";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { fromPartial } from "@total-typescript/shoehorn";
import { cleanup, render, screen, userEvent, within } from "~/test/test-utils";
import { HttpResponse, http, server } from "~/test/msw/server";
import type { Snapshot } from "~/client/lib/types";
import { RepositorySnapshotsTabContent } from "../snapshots";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

test("filters a host named all, combines text search, and clears both filters", async () => {
	vi.stubGlobal(
		"EventSource",
		class extends EventTarget {
			close() {}
		},
	);
	const snapshots: Snapshot[] = ["all", "other", ""].map((hostname, index) => ({
		short_id: `snap-${index}`,
		hostname,
		time: Date.UTC(2026, 8, 9),
		paths: ["/data"],
		size: 1024,
		duration: 1000,
		tags: [],
		retentionCategories: [],
	}));

	server.use(
		http.get("/api/v1/repositories/repo-1/snapshots", () => HttpResponse.json(snapshots)),
		http.get("/api/v1/backups", () => HttpResponse.json([])),
		http.get("/api/v1/tasks", () => HttpResponse.json([])),
	);

	const route = createRootRoute({
		component: () => (
			<RepositorySnapshotsTabContent
				repository={fromPartial({ shortId: "repo-1", name: "Repository", status: "healthy" })}
				initialSnapshots={snapshots}
				initialBackupSchedules={[]}
			/>
		),
	});

	const router = createRouter({ routeTree: route, history: createMemoryHistory({ initialEntries: ["/"] }) });
	render(<RouterProvider router={router} />, { withSuspense: true });

	await screen.findByText("snap-0");
	await userEvent.click(screen.getByRole("combobox", { name: "Filter snapshots by host" }));
	await userEvent.click(screen.getByRole("option", { name: /^all$/ }));

	expect(screen.getByText("snap-0")).toBeTruthy();
	expect(screen.queryByText("snap-1")).toBeNull();

	await userEvent.type(screen.getByPlaceholderText("Search snapshots..."), "snap-1");

	expect(screen.getByText("No snapshots match your filters.")).toBeTruthy();

	await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
	const table = await screen.findByRole("table");

	expect(within(table).getByText("snap-0")).toBeTruthy();
	expect(within(table).getByText("snap-1")).toBeTruthy();

	await userEvent.click(screen.getByRole("combobox", { name: "Filter snapshots by host" }));
	await userEvent.click(screen.getByRole("option", { name: "Unknown" }));

	expect(screen.getByText("snap-2")).toBeTruthy();
	expect(screen.queryByText("snap-0")).toBeNull();
});
