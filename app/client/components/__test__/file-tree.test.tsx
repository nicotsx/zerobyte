/** biome-ignore-all lint/style/noNonNullAssertion: Testing file - non-null assertions are acceptable here */
import { expect, test, describe } from "bun:test";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileTree, type FileEntry } from "../file-tree";

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
				getFolderPagination={() => ({ hasMore: true, isLoadingMore: false })}
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
				getFolderPagination={() => ({ hasMore: true, isLoadingMore: true })}
			/>,
		);

		expect(screen.getByText("Loading more...")).toBeTruthy();
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
				getFolderPagination={() => ({ hasMore: true, isLoadingMore: false })}
			/>,
		);

		expect(screen.queryByText("Load more files")).toBeNull();
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

	test("selecting a folder simplifies to parent if it's the only child", async () => {
		let currentSelection = new Set<string>();
		const onSelectionChange = (selection: Set<string>) => {
			currentSelection = selection;
		};

		render(
			<FileTree
				files={testFiles}
				withCheckboxes={true}
				selectedPaths={currentSelection}
				onSelectionChange={onSelectionChange}
				expandedFolders={new Set(testFiles.map((f) => f.path))}
			/>,
		);

		const photosCheckbox = screen.getByText("photos").parentElement?.querySelector('button[role="checkbox"]');
		expect(photosCheckbox).toBeTruthy();

		fireEvent.click(photosCheckbox!);

		expect(currentSelection.has("/root")).toBe(true);
		expect(currentSelection.size).toBe(1);
	});

	test("unselecting a child removes the parent from selection", async () => {
		let currentSelection = new Set<string>(["/root"]);
		const onSelectionChange = (selection: Set<string>) => {
			currentSelection = selection;
		};

		render(
			<FileTree
				files={testFiles}
				withCheckboxes={true}
				selectedPaths={currentSelection}
				onSelectionChange={onSelectionChange}
				expandedFolders={new Set(testFiles.map((f) => f.path))}
			/>,
		);

		const libraryCheckbox = screen.getByText("library").parentElement?.querySelector('button[role="checkbox"]');
		fireEvent.click(libraryCheckbox!);

		expect(currentSelection.has("/root")).toBe(false);
		expect(currentSelection.has("/root/photos")).toBe(false);

		expect(currentSelection.has("/root/photos/backups")).toBe(true);
		expect(currentSelection.has("/root/photos/profile")).toBe(true);
		expect(currentSelection.has("/root/photos/upload")).toBe(true);
		expect(currentSelection.size).toBe(3);
	});

	test("recursive simplification when all children are selected", async () => {
		let currentSelection = new Set<string>();
		const onSelectionChange = (selection: Set<string>) => {
			currentSelection = selection;
		};

		const { rerender } = render(
			<FileTree
				files={testFiles}
				withCheckboxes={true}
				selectedPaths={currentSelection}
				onSelectionChange={onSelectionChange}
				expandedFolders={new Set(testFiles.map((f) => f.path))}
			/>,
		);

		const children = ["backups", "library", "profile", "upload"];

		for (const name of children) {
			const checkbox = screen.getByText(name).parentElement?.querySelector('button[role="checkbox"]');
			fireEvent.click(checkbox!);

			rerender(
				<FileTree
					files={testFiles}
					withCheckboxes={true}
					selectedPaths={currentSelection}
					onSelectionChange={onSelectionChange}
					expandedFolders={new Set(testFiles.map((f) => f.path))}
				/>,
			);
		}

		expect(currentSelection.has("/root")).toBe(true);
		expect(currentSelection.size).toBe(1);
	});

	test("does not simplify to parent if not all children are selected", async () => {
		const multipleFiles: FileEntry[] = [
			{ name: "root", path: "/root", type: "folder" },
			{ name: "child1", path: "/root/child1", type: "folder" },
			{ name: "child2", path: "/root/child2", type: "folder" },
		];

		let currentSelection = new Set<string>();
		const onSelectionChange = (selection: Set<string>) => {
			currentSelection = selection;
		};

		render(
			<FileTree
				files={multipleFiles}
				withCheckboxes={true}
				selectedPaths={currentSelection}
				onSelectionChange={onSelectionChange}
				expandedFolders={new Set(multipleFiles.map((f) => f.path))}
			/>,
		);

		const child1Checkbox = screen.getByText("child1").parentElement?.querySelector('button[role="checkbox"]');
		fireEvent.click(child1Checkbox!);

		expect(currentSelection.has("/root/child1")).toBe(true);
		expect(currentSelection.has("/root")).toBe(false);
		expect(currentSelection.size).toBe(1);
	});

	test("simplifies existing deep paths when parent is selected", async () => {
		const files: FileEntry[] = [
			{ name: "hello", path: "/hello", type: "folder" },
			{ name: "hello_prev", path: "/hello_prev", type: "folder" },
			{ name: "service", path: "/service", type: "folder" },
		];

		let currentSelection = new Set<string>(["/hello", "/hello_prev", "/service/app/data/upload"]);
		const onSelectionChange = (selection: Set<string>) => {
			currentSelection = selection;
		};

		render(
			<FileTree
				files={files}
				withCheckboxes={true}
				selectedPaths={currentSelection}
				onSelectionChange={onSelectionChange}
			/>,
		);

		const serviceCheckbox = screen.getByText("service").parentElement?.querySelector('button[role="checkbox"]');
		expect(serviceCheckbox).toBeTruthy();

		fireEvent.click(serviceCheckbox!);

		expect(currentSelection.has("/service")).toBe(true);
		expect(currentSelection.has("/service/app/data/upload")).toBe(false);
		expect(currentSelection.size).toBe(3); // /hello, /hello_prev, /service
	});
});
