import type { ComponentProps } from "react";
import { afterEach, describe, expect, test } from "bun:test";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent, waitFor, within } from "~/test/test-utils";

type SnapshotFilesRequest = {
	shortId: string;
	snapshotId: string;
	path: string | null;
	offset: string | null;
	limit: string | null;
};

const snapshotFiles = {
	files: [
		{ name: "project", path: "/mnt/project", type: "dir" },
		{ name: "a.txt", path: "/mnt/project/a.txt", type: "file" },
	],
};

import { SnapshotTreeBrowser } from "../snapshot-tree-browser";

const mockListSnapshotFiles = () => {
	const requests: SnapshotFilesRequest[] = [];

	server.use(
		http.get("/api/v1/repositories/:shortId/snapshots/:snapshotId/files", ({ params, request }) => {
			const url = new URL(request.url);
			requests.push({
				shortId: String(params.shortId),
				snapshotId: String(params.snapshotId),
				path: url.searchParams.get("path"),
				offset: url.searchParams.get("offset"),
				limit: url.searchParams.get("limit"),
			});

			return HttpResponse.json(snapshotFiles);
		}),
	);

	return requests;
};

const renderSnapshotTreeBrowser = (props: Partial<ComponentProps<typeof SnapshotTreeBrowser>> = {}) => {
	return render(
		<SnapshotTreeBrowser
			repositoryId="repo-1"
			snapshotId="snap-1"
			queryBasePath="/mnt/project"
			displayBasePath="/mnt"
			{...props}
		/>,
	);
};

afterEach(() => {
	cleanup();
});

describe("SnapshotTreeBrowser", () => {
	test("renders the query root folder when display base path is broader than query base path", async () => {
		mockListSnapshotFiles();

		renderSnapshotTreeBrowser();

		expect(await screen.findByRole("button", { name: "project" })).toBeTruthy();
	});

	test("shows selected folder state when full paths are provided from the parent", async () => {
		mockListSnapshotFiles();

		renderSnapshotTreeBrowser({
			withCheckboxes: true,
			selectedPaths: new Set(["/mnt/project"]),
			onSelectionChange: () => {},
		});

		const row = await screen.findByRole("button", { name: "project" });
		const checkbox = within(row).getByRole("checkbox");

		expect(checkbox.getAttribute("aria-checked")).toBe("true");
	});

	test("returns the full snapshot path and kind when selecting a displayed folder", async () => {
		mockListSnapshotFiles();

		let selectedPaths: Set<string> | undefined;
		let selectedKind: "file" | "dir" | null = null;

		renderSnapshotTreeBrowser({
			withCheckboxes: true,
			onSelectionChange: (paths) => {
				selectedPaths = paths;
			},
			onSingleSelectionKindChange: (kind) => {
				selectedKind = kind;
			},
		});

		const row = await screen.findByRole("button", { name: "project" });
		const checkbox = within(row).getByRole("checkbox");

		await userEvent.click(checkbox);

		expect(selectedPaths ? Array.from(selectedPaths) : []).toEqual(["/mnt/project"]);
		expect(selectedKind === "dir").toBe(true);
	});

	test("uses the query base path for the initial request when display base path is broader", async () => {
		const requests = mockListSnapshotFiles();

		renderSnapshotTreeBrowser();

		await waitFor(() => {
			expect(requests[0]).toEqual({
				shortId: "repo-1",
				snapshotId: "snap-1",
				path: "/mnt/project",
				offset: null,
				limit: null,
			});
		});
	});

	test("prefetches using the query path when display and query roots differ", async () => {
		const requests = mockListSnapshotFiles();

		renderSnapshotTreeBrowser();

		const row = await screen.findByRole("button", { name: "project" });
		const initialRequestCount = requests.length;

		await userEvent.hover(row);

		await waitFor(() => {
			expect(requests.length).toBe(initialRequestCount + 1);
		});

		expect(requests.at(-1)).toEqual({
			shortId: "repo-1",
			snapshotId: "snap-1",
			path: "/mnt/project",
			offset: "0",
			limit: "500",
		});
	});

	test("expands using the query path when display and query roots differ", async () => {
		const requests = mockListSnapshotFiles();

		renderSnapshotTreeBrowser();

		const row = await screen.findByRole("button", { name: "project" });
		const expandIcon = row.querySelector("svg");
		if (!expandIcon) {
			throw new Error("Expected expand icon for folder row");
		}

		const initialRequestCount = requests.length;
		await userEvent.click(expandIcon);

		await waitFor(() => {
			expect(requests.length).toBeGreaterThan(initialRequestCount);
		});

		expect(requests.at(-1)).toEqual({
			shortId: "repo-1",
			snapshotId: "snap-1",
			path: "/mnt/project",
			offset: "0",
			limit: "500",
		});
	});
});
