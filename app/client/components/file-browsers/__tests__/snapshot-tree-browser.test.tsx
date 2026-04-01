import type { ComponentProps } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, fireEvent, render, screen, userEvent, waitFor, within } from "~/test/test-utils";

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

const mockListSnapshotFiles = (response = snapshotFiles) => {
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

			return HttpResponse.json(response);
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

	test("renders ancestor folders when the query root is nested multiple levels below the display root", async () => {
		mockListSnapshotFiles({
			files: [
				{ name: "subdir", path: "/mnt/project/subdir", type: "dir" },
				{ name: "a.txt", path: "/mnt/project/subdir/a.txt", type: "file" },
			],
		});

		renderSnapshotTreeBrowser({
			queryBasePath: "/mnt/project/subdir",
			displayBasePath: "/mnt",
		});

		expect(await screen.findByRole("button", { name: "project" })).toBeTruthy();
	});

	test("renders synthesized ancestor folders for a single file when no display base path is available", async () => {
		const requests = mockListSnapshotFiles({
			files: [{ name: "report.txt", path: "/mnt/project/report.txt", type: "file" }],
		});

		renderSnapshotTreeBrowser({
			queryBasePath: "/mnt/project/report.txt",
			displayBasePath: undefined,
		});

		const mntRow = await screen.findByRole("button", { name: "mnt" });
		const mntExpandIcon = mntRow.querySelector("svg");
		if (!mntExpandIcon) {
			throw new Error("Expected expand icon for mnt row");
		}
		fireEvent.click(mntExpandIcon);

		expect(await screen.findByRole("button", { name: "project" })).toBeTruthy();
		expect(requests[0]).toEqual({
			shortId: "repo-1",
			snapshotId: "snap-1",
			path: "/mnt/project/report.txt",
			offset: null,
			limit: null,
		});
	});

	test("returns the ancestor folder path when selecting above the query root", async () => {
		mockListSnapshotFiles({
			files: [
				{ name: "subdir", path: "/mnt/project/subdir", type: "dir" },
				{ name: "a.txt", path: "/mnt/project/subdir/a.txt", type: "file" },
			],
		});

		let selectedPaths: Set<string> | undefined;
		let selectedKind: "file" | "dir" | null = null;

		renderSnapshotTreeBrowser({
			queryBasePath: "/mnt/project/subdir",
			displayBasePath: "/mnt",
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

	test("keeps full paths when the display root does not contain the query root", async () => {
		mockListSnapshotFiles();

		let selectedPaths: Set<string> | undefined;
		let selectedKind: "file" | "dir" | null = null;

		renderSnapshotTreeBrowser({
			queryBasePath: "/mnt/project",
			displayBasePath: "/other/root",
			withCheckboxes: true,
			onSelectionChange: (paths) => {
				selectedPaths = paths;
			},
			onSingleSelectionKindChange: (kind) => {
				selectedKind = kind;
			},
		});

		const row = await screen.findByRole("button", { name: "mnt" });
		const checkbox = within(row).getByRole("checkbox");

		await userEvent.click(checkbox);

		expect(selectedPaths ? Array.from(selectedPaths) : []).toEqual(["/mnt"]);
		expect(selectedKind === "dir").toBe(true);
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

	test("shows the query root contents when display and query roots differ", async () => {
		mockListSnapshotFiles();

		renderSnapshotTreeBrowser();

		const row = await screen.findByRole("button", { name: "project" });
		const expandIcon = row.querySelector("svg");
		if (!expandIcon) {
			throw new Error("Expected expand icon for folder row");
		}

		if (!screen.queryByRole("button", { name: "a.txt" })) {
			fireEvent.click(expandIcon);
		}

		expect(await screen.findByRole("button", { name: "a.txt" })).toBeTruthy();
	});
});
