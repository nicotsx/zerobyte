import { expect, test, describe } from "bun:test";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileTree, type FileEntry } from "../file-tree";

describe("FileTree Selection Logic", () => {
	const immichFiles: FileEntry[] = [
		{ name: "immich", path: "/immich", type: "folder" },
		{ name: "immich_photos", path: "/immich/immich_photos", type: "folder" },
		{ name: "backups", path: "/immich/immich_photos/backups", type: "folder" },
		{ name: "library", path: "/immich/immich_photos/library", type: "folder" },
		{ name: "profile", path: "/immich/immich_photos/profile", type: "folder" },
		{ name: "upload", path: "/immich/immich_photos/upload", type: "folder" },
	];

	test("selecting a folder simplifies to parent if it's the only child", async () => {
		let currentSelection = new Set<string>();
		const onSelectionChange = (selection: Set<string>) => {
			currentSelection = selection;
		};

		render(
			<FileTree
				files={immichFiles}
				withCheckboxes={true}
				selectedPaths={currentSelection}
				onSelectionChange={onSelectionChange}
				expandedFolders={new Set(immichFiles.map((f) => f.path))}
			/>,
		);

		const immichPhotosCheckbox = screen
			.getByText("immich_photos")
			.parentElement?.querySelector('button[role="checkbox"]');
		expect(immichPhotosCheckbox).toBeTruthy();

		fireEvent.click(immichPhotosCheckbox!);

		expect(currentSelection.has("/immich")).toBe(true);
		expect(currentSelection.size).toBe(1);
	});

	test("unselecting a child removes the parent from selection", async () => {
		let currentSelection = new Set<string>(["/immich"]);
		const onSelectionChange = (selection: Set<string>) => {
			currentSelection = selection;
		};

		render(
			<FileTree
				files={immichFiles}
				withCheckboxes={true}
				selectedPaths={currentSelection}
				onSelectionChange={onSelectionChange}
				expandedFolders={new Set(immichFiles.map((f) => f.path))}
			/>,
		);

		const libraryCheckbox = screen.getByText("library").parentElement?.querySelector('button[role="checkbox"]');
		fireEvent.click(libraryCheckbox!);

		expect(currentSelection.has("/immich")).toBe(false);
		expect(currentSelection.has("/immich/immich_photos")).toBe(false);

		expect(currentSelection.has("/immich/immich_photos/backups")).toBe(true);
		expect(currentSelection.has("/immich/immich_photos/profile")).toBe(true);
		expect(currentSelection.has("/immich/immich_photos/upload")).toBe(true);
		expect(currentSelection.size).toBe(3);
	});

	test("recursive simplification when all children are selected", async () => {
		let currentSelection = new Set<string>();
		const onSelectionChange = (selection: Set<string>) => {
			currentSelection = selection;
		};

		const { rerender } = render(
			<FileTree
				files={immichFiles}
				withCheckboxes={true}
				selectedPaths={currentSelection}
				onSelectionChange={onSelectionChange}
				expandedFolders={new Set(immichFiles.map((f) => f.path))}
			/>,
		);

		const children = ["backups", "library", "profile", "upload"];

		for (const name of children) {
			const checkbox = screen.getByText(name).parentElement?.querySelector('button[role="checkbox"]');
			fireEvent.click(checkbox!);

			rerender(
				<FileTree
					files={immichFiles}
					withCheckboxes={true}
					selectedPaths={currentSelection}
					onSelectionChange={onSelectionChange}
					expandedFolders={new Set(immichFiles.map((f) => f.path))}
				/>,
			);
		}

		expect(currentSelection.has("/immich")).toBe(true);
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
});
