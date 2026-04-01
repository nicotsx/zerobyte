/** biome-ignore-all lint/style/noNonNullAssertion: Testing file - non-null assertions are acceptable here */
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { useState } from "react";
import { FileTree, type FileEntry } from "../file-tree";

const getCheckboxFor = (name: string) => {
	const row = screen.getByRole("button", { name });
	return within(row).getByRole("checkbox");
};

const FileTreeSelection = ({
	files,
	initialSelectedPaths = [],
	expandedFolders,
}: {
	files: FileEntry[];
	initialSelectedPaths?: string[];
	expandedFolders?: Set<string>;
}) => {
	const [selectedPaths, setSelectedPaths] = useState(() => new Set(initialSelectedPaths));

	return (
		<>
			<FileTree
				files={files}
				withCheckboxes={true}
				selectedPaths={selectedPaths}
				onSelectionChange={setSelectedPaths}
				expandedFolders={expandedFolders}
			/>
			<output aria-label="Selected paths">{JSON.stringify(Array.from(selectedPaths).sort())}</output>
		</>
	);
};

const getSelectedPaths = () => {
	const selectedPaths = screen.getByLabelText("Selected paths").textContent;
	return JSON.parse(selectedPaths ?? "[]") as string[];
};

afterEach(() => {
	cleanup();
});

describe("FileTree Pagination", () => {
	const testFiles: FileEntry[] = [
		{ name: "root", path: "/root", type: "folder" },
		{ name: "file1", path: "/root/file1", type: "file" },
		{ name: "file2", path: "/root/file2", type: "file" },
	];

	test("shows load more button when hasMore is true", () => {
		render(
			<FileTree
				files={testFiles}
				expandedFolders={new Set(["/root"])}
				getFolderPagination={(path) => {
					if (path === "/root") {
						return { hasMore: true, isLoadingMore: false };
					}
					return { hasMore: false, isLoadingMore: false };
				}}
			/>,
		);

		expect(screen.getByText("Load more files")).toBeTruthy();
	});

	test("does not show load more button when hasMore is false", () => {
		render(
			<FileTree
				files={testFiles}
				expandedFolders={new Set(["/root"])}
				getFolderPagination={() => ({ hasMore: false, isLoadingMore: false })}
			/>,
		);

		expect(screen.queryByText("Load more files")).toBeNull();
	});

	test("calls onLoadMore with folder path when load more button is clicked", () => {
		let loadMoreCalled = false;
		let loadMorePath = "";

		render(
			<FileTree
				files={testFiles}
				expandedFolders={new Set(["/root"])}
				getFolderPagination={(path) => {
					if (path === "/root") {
						return { hasMore: true, isLoadingMore: false };
					}
					return { hasMore: false, isLoadingMore: false };
				}}
				onLoadMore={(path) => {
					loadMoreCalled = true;
					loadMorePath = path;
				}}
			/>,
		);

		const loadMoreButton = screen.getByText("Load more files");
		fireEvent.click(loadMoreButton);

		expect(loadMoreCalled).toBe(true);
		expect(loadMorePath).toBe("/root");
	});

	test("shows loading state when isLoadingMore is true", () => {
		render(
			<FileTree
				files={testFiles}
				expandedFolders={new Set(["/root"])}
				getFolderPagination={(path) => {
					if (path === "/root") {
						return { hasMore: true, isLoadingMore: true };
					}
					return { hasMore: false, isLoadingMore: false };
				}}
			/>,
		);

		expect(screen.getByText("Loading more...")).toBeTruthy();
	});

	test("shows load more button for root-level files when root has more", () => {
		const rootFiles: FileEntry[] = [
			{ name: "file1", path: "/file1", type: "file" },
			{ name: "file2", path: "/file2", type: "file" },
		];

		render(
			<FileTree
				files={rootFiles}
				getFolderPagination={(path) => {
					if (path === "/") {
						return { hasMore: true, isLoadingMore: false };
					}
					return { hasMore: false, isLoadingMore: false };
				}}
			/>,
		);

		expect(screen.getByText("Load more files")).toBeTruthy();
	});

	test("load more button appears for nested folders with hasMore", () => {
		const nestedFiles: FileEntry[] = [
			{ name: "root", path: "/root", type: "folder" },
			{ name: "child", path: "/root/child", type: "folder" },
			{ name: "file1", path: "/root/child/file1", type: "file" },
		];

		render(
			<FileTree
				files={nestedFiles}
				expandedFolders={new Set(["/root", "/root/child"])}
				getFolderPagination={(path) => {
					if (path === "/root/child") {
						return { hasMore: true, isLoadingMore: false };
					}
					return { hasMore: false, isLoadingMore: false };
				}}
				onLoadMore={() => {}}
			/>,
		);

		expect(screen.getByText("Load more files")).toBeTruthy();
	});

	test("load more button does not appear when folder is collapsed", () => {
		render(
			<FileTree
				files={testFiles}
				expandedFolders={new Set([])}
				getFolderPagination={(path) => {
					if (path === "/root") {
						return { hasMore: true, isLoadingMore: false };
					}
					return { hasMore: false, isLoadingMore: false };
				}}
			/>,
		);

		expect(screen.queryByText("Load more files")).toBeNull();
	});

	test("renders missing ancestor folders for nested paths", () => {
		render(
			<FileTree
				files={[
					{ name: "subdir", path: "/project/subdir", type: "folder" },
					{ name: "file1", path: "/project/subdir/file1", type: "file" },
				]}
			/>,
		);

		expect(screen.getByRole("button", { name: "project" })).toBeTruthy();
	});
});

describe("FileTree Selection Logic", () => {
	const testFiles: FileEntry[] = [
		{ name: "root", path: "/root", type: "folder" },
		{ name: "photos", path: "/root/photos", type: "folder" },
		{ name: "backups", path: "/root/photos/backups", type: "folder" },
		{ name: "library", path: "/root/photos/library", type: "folder" },
		{ name: "profile", path: "/root/photos/profile", type: "folder" },
		{ name: "upload", path: "/root/photos/upload", type: "folder" },
	];

	test("selecting a folder simplifies to parent if it's the only child", () => {
		render(<FileTreeSelection files={testFiles} expandedFolders={new Set(testFiles.map((f) => f.path))} />);

		fireEvent.click(getCheckboxFor("photos"));

		expect(getSelectedPaths()).toEqual(["/root"]);
	});

	test("unselecting a child removes the parent from selection", () => {
		render(
			<FileTreeSelection
				files={testFiles}
				initialSelectedPaths={["/root"]}
				expandedFolders={new Set(testFiles.map((f) => f.path))}
			/>,
		);

		fireEvent.click(getCheckboxFor("library"));

		expect(getSelectedPaths()).toEqual(["/root/photos/backups", "/root/photos/profile", "/root/photos/upload"]);
	});

	test("recursive simplification when all children are selected", () => {
		render(<FileTreeSelection files={testFiles} expandedFolders={new Set(testFiles.map((f) => f.path))} />);

		const children = ["backups", "library", "profile", "upload"];

		for (const name of children) {
			fireEvent.click(getCheckboxFor(name));
		}

		expect(getSelectedPaths()).toEqual(["/root"]);
	});

	test("does not simplify to parent if not all children are selected", () => {
		const multipleFiles: FileEntry[] = [
			{ name: "root", path: "/root", type: "folder" },
			{ name: "child1", path: "/root/child1", type: "folder" },
			{ name: "child2", path: "/root/child2", type: "folder" },
		];

		render(<FileTreeSelection files={multipleFiles} expandedFolders={new Set(multipleFiles.map((f) => f.path))} />);

		fireEvent.click(getCheckboxFor("child1"));

		expect(getSelectedPaths()).toEqual(["/root/child1"]);
	});

	test("simplifies existing deep paths when parent is selected", () => {
		const files: FileEntry[] = [
			{ name: "hello", path: "/hello", type: "folder" },
			{ name: "hello_prev", path: "/hello_prev", type: "folder" },
			{ name: "service", path: "/service", type: "folder" },
		];

		render(
			<FileTreeSelection files={files} initialSelectedPaths={["/hello", "/hello_prev", "/service/app/data/upload"]} />,
		);

		fireEvent.click(getCheckboxFor("service"));

		expect(getSelectedPaths()).toEqual(["/hello", "/hello_prev", "/service"]);
	});
});
