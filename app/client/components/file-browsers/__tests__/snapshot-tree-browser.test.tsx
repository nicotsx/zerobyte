import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const snapshotFiles = {
	files: [
		{ name: "project", path: "/mnt/project", type: "dir" },
		{ name: "a.txt", path: "/mnt/project/a.txt", type: "file" },
	],
};

await mock.module("@tanstack/react-query", () => ({
	useQuery: () => ({ data: snapshotFiles, isLoading: false, error: null }),
	useQueryClient: () => ({
		ensureQueryData: async () => snapshotFiles,
		prefetchQuery: async () => undefined,
	}),
}));

import { SnapshotTreeBrowser } from "../snapshot-tree-browser";

afterEach(() => {
	cleanup();
});

describe("SnapshotTreeBrowser", () => {
	test("renders the query root folder when display base path is broader than query base path", () => {
		render(
			<SnapshotTreeBrowser
				repositoryId="repo-1"
				snapshotId="snap-1"
				queryBasePath="/mnt/project"
				displayBasePath="/mnt"
			/>,
		);

		screen.getByRole("button", { name: "project" });
	});

	test("shows selected folder state when full paths are provided from the parent", () => {
		render(
			<SnapshotTreeBrowser
				repositoryId="repo-1"
				snapshotId="snap-1"
				queryBasePath="/mnt/project"
				displayBasePath="/mnt"
				withCheckboxes
				selectedPaths={new Set(["/mnt/project"])}
				onSelectionChange={() => {}}
			/>,
		);

		const row = screen.getByRole("button", { name: "project" });
		const checkbox = within(row).getByRole("checkbox");

		expect(checkbox.getAttribute("aria-checked")).toBe("true");
	});

	test("returns the full snapshot path and kind when selecting a displayed folder", () => {
		let selectedPaths: Set<string> | undefined;
		let selectedKind: "file" | "dir" | null = null;

		render(
			<SnapshotTreeBrowser
				repositoryId="repo-1"
				snapshotId="snap-1"
				queryBasePath="/mnt/project"
				displayBasePath="/mnt"
				withCheckboxes
				onSelectionChange={(paths) => {
					selectedPaths = paths;
				}}
				onSingleSelectionKindChange={(kind) => {
					selectedKind = kind;
				}}
			/>,
		);

		const row = screen.getByRole("button", { name: "project" });
		const checkbox = within(row).getByRole("checkbox");

		fireEvent.click(checkbox);

		expect(selectedPaths ? Array.from(selectedPaths) : []).toEqual(["/mnt/project"]);
		expect(selectedKind === "dir").toBe(true);
	});
});
