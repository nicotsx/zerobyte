/**
 * FileTree Component
 *
 * Adapted from bolt.new by StackBlitz
 * Copyright (c) 2024 StackBlitz, Inc.
 * Licensed under the MIT License
 *
 * Original source: https://github.com/stackblitz/bolt.new
 */

import { ChevronDown, ChevronRight, File as FileIcon, Folder as FolderIcon, FolderOpen, Loader2 } from "lucide-react";
import { memo, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "~/client/lib/utils";
import { Checkbox } from "~/client/components/ui/checkbox";
import { ByteSize } from "~/client/components/bytes-size";

const NODE_PADDING_LEFT = 12;

export interface FileEntry {
	name: string;
	path: string;
	type: string;
	size?: number;
	modifiedAt?: number;
}

interface Props {
	files?: FileEntry[];
	selectedFile?: string;
	onFileSelect?: (filePath: string) => void;
	onFolderExpand?: (folderPath: string) => void;
	onFolderHover?: (folderPath: string) => void;
	expandedFolders?: Set<string>;
	loadingFolders?: Set<string>;
	className?: string;
	withCheckboxes?: boolean;
	selectedPaths?: Set<string>;
	onSelectionChange?: (selectedPaths: Set<string>) => void;
	foldersOnly?: boolean;
	selectableFolders?: boolean;
	onFolderSelect?: (folderPath: string) => void;
	selectedFolder?: string;
}

export const FileTree = memo((props: Props) => {
	const {
		files = [],
		onFileSelect,
		selectedFile,
		onFolderExpand,
		onFolderHover,
		expandedFolders = new Set(),
		loadingFolders = new Set(),
		className,
		withCheckboxes = false,
		selectedPaths = new Set(),
		onSelectionChange,
		foldersOnly = false,
		selectableFolders = false,
		onFolderSelect,
		selectedFolder,
	} = props;

	const fileList = useMemo(() => {
		return buildFileList(files, foldersOnly);
	}, [files, foldersOnly]);

	const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

	const filteredFileList = useMemo(() => {
		const list = [];
		let lastDepth = Number.MAX_SAFE_INTEGER;

		for (const fileOrFolder of fileList) {
			const depth = fileOrFolder.depth;

			// if the depth is equal we reached the end of the collapsed group
			if (lastDepth === depth) {
				lastDepth = Number.MAX_SAFE_INTEGER;
			}

			// ignore collapsed folders
			if (collapsedFolders.has(fileOrFolder.fullPath)) {
				lastDepth = Math.min(lastDepth, depth);
			}

			// ignore files and folders below the last collapsed folder
			if (lastDepth < depth) {
				continue;
			}

			list.push(fileOrFolder);
		}

		return list;
	}, [fileList, collapsedFolders]);

	const toggleCollapseState = useCallback(
		(fullPath: string) => {
			setCollapsedFolders((prevSet) => {
				const newSet = new Set(prevSet);

				if (newSet.has(fullPath)) {
					newSet.delete(fullPath);
					onFolderExpand?.(fullPath);
				} else {
					newSet.add(fullPath);
				}

				return newSet;
			});
		},
		[onFolderExpand],
	);

	// Add new folders to collapsed set when file list changes
	useEffect(() => {
		setCollapsedFolders((prevSet) => {
			const newSet = new Set(prevSet);
			for (const item of fileList) {
				if (item.kind === "folder" && !newSet.has(item.fullPath) && !expandedFolders.has(item.fullPath)) {
					newSet.add(item.fullPath);
				}
			}
			return newSet;
		});
	}, [fileList, expandedFolders]);

	const handleFileSelect = useCallback(
		(filePath: string) => {
			onFileSelect?.(filePath);
		},
		[onFileSelect],
	);

	const handleFolderSelect = useCallback(
		(folderPath: string) => {
			onFolderSelect?.(folderPath);
		},
		[onFolderSelect],
	);

	const handleSelectionChange = useCallback(
		(path: string, checked: boolean) => {
			const newSelection = new Set(selectedPaths);

			if (checked) {
				// Add the path itself
				newSelection.add(path);

				// Remove any descendants from selection since parent now covers them
				for (const item of fileList) {
					if (item.fullPath.startsWith(`${path}/`)) {
						newSelection.delete(item.fullPath);
					}
				}
			} else {
				// Remove the path itself
				newSelection.delete(path);

				// Check if any parent is selected - if so, we need to add siblings back
				const pathSegments = path.split("/").filter(Boolean);
				let parentIsSelected = false;
				let selectedParentPath = "";

				// Check each parent level to see if any are selected
				for (let i = pathSegments.length - 1; i > 0; i--) {
					const parentPath = `/${pathSegments.slice(0, i).join("/")}`;
					if (newSelection.has(parentPath)) {
						parentIsSelected = true;
						selectedParentPath = parentPath;
						break;
					}
				}

				if (parentIsSelected) {
					// Remove the selected parent
					newSelection.delete(selectedParentPath);

					// Add all siblings and descendants of the selected parent, except the unchecked path and its descendants
					for (const item of fileList) {
						if (
							item.fullPath.startsWith(`${selectedParentPath}/`) &&
							!item.fullPath.startsWith(`${path}/`) &&
							item.fullPath !== path
						) {
							newSelection.add(item.fullPath);
						}
					}
				}
			}

			const childrenByParent = new Map<string, string[]>();
			for (const selectedPath of newSelection) {
				const lastSlashIndex = selectedPath.lastIndexOf("/");
				if (lastSlashIndex > 0) {
					const parentPath = selectedPath.slice(0, lastSlashIndex);
					if (!childrenByParent.has(parentPath)) {
						childrenByParent.set(parentPath, []);
					}
					childrenByParent.get(parentPath)?.push(selectedPath);
				}
			}

			// For each parent, check if all its children are selected
			for (const [parentPath, selectedChildren] of childrenByParent.entries()) {
				// Get all children of this parent from the file list
				const allChildren = fileList.filter((item) => {
					const itemParentPath = item.fullPath.slice(0, item.fullPath.lastIndexOf("/"));
					return itemParentPath === parentPath;
				});

				// If all children are selected, replace them with the parent
				if (allChildren.length > 0 && selectedChildren.length === allChildren.length) {
					// Check that we have every child
					const allChildrenPaths = new Set(allChildren.map((c) => c.fullPath));
					const allChildrenSelected = selectedChildren.every((c) => allChildrenPaths.has(c));

					if (allChildrenSelected) {
						// Remove all children
						for (const childPath of selectedChildren) {
							newSelection.delete(childPath);
						}
						// Add the parent
						newSelection.add(parentPath);
					}
				}
			}

			onSelectionChange?.(newSelection);
		},
		[selectedPaths, onSelectionChange, fileList],
	);

	// Helper to check if a path is selected (either directly or via parent)
	const isPathSelected = useCallback(
		(path: string): boolean => {
			// Check if directly selected
			if (selectedPaths.has(path)) {
				return true;
			}

			// Check if any parent is selected
			const pathSegments = path.split("/").filter(Boolean);
			for (let i = pathSegments.length - 1; i > 0; i--) {
				const parentPath = `/${pathSegments.slice(0, i).join("/")}`;
				if (selectedPaths.has(parentPath)) {
					return true;
				}
			}

			return false;
		},
		[selectedPaths],
	);

	// Determine if a folder is partially selected (some children selected)
	const isPartiallySelected = useCallback(
		(folderPath: string): boolean => {
			// If the folder itself is selected, it's not partial
			if (selectedPaths.has(folderPath)) {
				return false;
			}

			// Check if this folder is implicitly selected via a parent
			const pathSegments = folderPath.split("/").filter(Boolean);
			for (let i = pathSegments.length - 1; i > 0; i--) {
				const parentPath = `/${pathSegments.slice(0, i).join("/")}`;
				if (selectedPaths.has(parentPath)) {
					// Parent is selected, so this folder is fully selected, not partial
					return false;
				}
			}

			for (const selectedPath of selectedPaths) {
				if (selectedPath.startsWith(`${folderPath}/`)) {
					return true;
				}
			}

			return false;
		},
		[selectedPaths],
	);

	return (
		<div className={cn("text-sm", className)}>
			{filteredFileList.map((fileOrFolder) => {
				switch (fileOrFolder.kind) {
					case "file": {
						return (
							<File
								key={fileOrFolder.id}
								selected={selectedFile === fileOrFolder.fullPath}
								file={fileOrFolder}
								onFileSelect={handleFileSelect}
								withCheckbox={withCheckboxes}
								checked={isPathSelected(fileOrFolder.fullPath)}
								onCheckboxChange={handleSelectionChange}
							/>
						);
					}
					case "folder": {
						return (
							<Folder
								key={fileOrFolder.id}
								folder={fileOrFolder}
								collapsed={collapsedFolders.has(fileOrFolder.fullPath)}
								loading={loadingFolders.has(fileOrFolder.fullPath)}
								onToggle={toggleCollapseState}
								onHover={onFolderHover}
								withCheckbox={withCheckboxes}
								checked={isPathSelected(fileOrFolder.fullPath) && !isPartiallySelected(fileOrFolder.fullPath)}
								partiallyChecked={isPartiallySelected(fileOrFolder.fullPath)}
								onCheckboxChange={handleSelectionChange}
								selectableMode={selectableFolders}
								onFolderSelect={handleFolderSelect}
								selected={selectedFolder === fileOrFolder.fullPath}
							/>
						);
					}
					default: {
						return undefined;
					}
				}
			})}
		</div>
	);
});

interface FolderProps {
	folder: FolderNode;
	collapsed: boolean;
	loading?: boolean;
	onToggle: (fullPath: string) => void;
	onHover?: (fullPath: string) => void;
	withCheckbox?: boolean;
	checked?: boolean;
	partiallyChecked?: boolean;
	onCheckboxChange?: (path: string, checked: boolean) => void;
	selectableMode?: boolean;
	onFolderSelect?: (folderPath: string) => void;
	selected?: boolean;
}

const Folder = memo(
	({
		folder,
		collapsed,
		loading,
		onToggle,
		onHover,
		withCheckbox,
		checked,
		partiallyChecked,
		onCheckboxChange,
		selectableMode,
		onFolderSelect,
		selected,
	}: FolderProps) => {
		const { depth, name, fullPath } = folder;
		const FolderIconComponent = collapsed ? FolderIcon : FolderOpen;

		const handleChevronClick = useCallback(
			(e: React.MouseEvent) => {
				e.stopPropagation();
				onToggle(fullPath);
			},
			[onToggle, fullPath],
		);

		const handleMouseEnter = useCallback(() => {
			if (collapsed) {
				onHover?.(fullPath);
			}
		}, [onHover, fullPath, collapsed]);

		const handleCheckboxChange = useCallback(
			(value: boolean) => {
				onCheckboxChange?.(fullPath, value);
			},
			[onCheckboxChange, fullPath],
		);

		const handleFolderClick = useCallback(() => {
			if (selectableMode) {
				onFolderSelect?.(fullPath);
			}
		}, [selectableMode, onFolderSelect, fullPath]);

		return (
			<NodeButton
				className={cn("group", {
					"hover:bg-accent/50 text-foreground": !selected,
					"bg-accent text-accent-foreground": selected,
					"cursor-pointer": selectableMode,
				})}
				depth={depth}
				icon={
					loading ? (
						<Loader2 className="w-4 h-4 shrink-0 animate-spin" />
					) : collapsed ? (
						<ChevronRight className="w-4 h-4 shrink-0 cursor-pointer" onClick={handleChevronClick} />
					) : (
						<ChevronDown className="w-4 h-4 shrink-0 cursor-pointer" onClick={handleChevronClick} />
					)
				}
				onClick={selectableMode ? handleFolderClick : undefined}
				onMouseEnter={handleMouseEnter}
			>
				{withCheckbox && (
					<Checkbox
						checked={checked ? true : partiallyChecked ? "indeterminate" : false}
						onCheckedChange={handleCheckboxChange}
						onClick={(e) => e.stopPropagation()}
					/>
				)}
				<FolderIconComponent className="w-4 h-4 shrink-0 text-strong-accent" />
				<span className="truncate">{name}</span>
			</NodeButton>
		);
	},
);

interface FileProps {
	file: FileNode;
	selected: boolean;
	onFileSelect: (filePath: string) => void;
	withCheckbox?: boolean;
	checked?: boolean;
	onCheckboxChange?: (path: string, checked: boolean) => void;
}

const File = memo(({ file, onFileSelect, selected, withCheckbox, checked, onCheckboxChange }: FileProps) => {
	const { depth, name, fullPath, size } = file;

	const handleClick = useCallback(() => {
		onFileSelect(fullPath);
	}, [onFileSelect, fullPath]);

	const handleCheckboxChange = useCallback(
		(value: boolean) => {
			onCheckboxChange?.(fullPath, value);
		},
		[onCheckboxChange, fullPath],
	);

	return (
		<NodeButton
			className={cn("group cursor-pointer", {
				"hover:bg-accent/50 text-foreground": !selected,
				"bg-accent text-accent-foreground": selected,
			})}
			depth={depth}
			icon={<FileIcon className="w-4 h-4 shrink-0 text-gray-500" />}
			onClick={handleClick}
		>
			{withCheckbox && (
				<Checkbox checked={checked} onCheckedChange={handleCheckboxChange} onClick={(e) => e.stopPropagation()} />
			)}
			<span className="truncate">{name}</span>
			{typeof size === "number" && (
				<span className="ml-auto shrink-0 text-xs text-muted-foreground">
					<ByteSize bytes={size} />
				</span>
			)}
		</NodeButton>
	);
});

interface ButtonProps {
	depth: number;
	icon: ReactNode;
	children: ReactNode;
	className?: string;
	onClick?: () => void;
	onMouseEnter?: () => void;
}

const NodeButton = memo(({ depth, icon, onClick, onMouseEnter, className, children }: ButtonProps) => {
	const paddingLeft = useMemo(() => `${8 + depth * NODE_PADDING_LEFT}px`, [depth]);

	return (
		<button
			type="button"
			className={cn("flex items-center gap-2 w-full pr-2 text-sm py-1.5 text-left", className)}
			style={{ paddingLeft }}
			onClick={onClick}
			onMouseEnter={onMouseEnter}
		>
			{icon}
			<div className="truncate w-full flex items-center gap-2">{children}</div>
		</button>
	);
});

type Node = FileNode | FolderNode;

interface BaseNode {
	id: number;
	depth: number;
	name: string;
	fullPath: string;
}

interface FileNode extends BaseNode {
	kind: "file";
	size?: number;
}

interface FolderNode extends BaseNode {
	kind: "folder";
}

function buildFileList(files: FileEntry[], foldersOnly = false): Node[] {
	const fileMap = new Map<string, Node>();

	for (const file of files) {
		if (foldersOnly && file.type === "file") {
			continue;
		}

		const segments = file.path.split("/").filter((segment) => segment);
		const depth = segments.length - 1;
		const name = segments[segments.length - 1];

		if (!fileMap.has(file.path)) {
			const isFile = file.type === "file";
			fileMap.set(file.path, {
				kind: isFile ? "file" : "folder",
				id: fileMap.size,
				name,
				fullPath: file.path,
				depth,
				size: file.size,
			});
		}
	}

	// Convert map to array and sort
	return sortFileList(Array.from(fileMap.values()));
}

function sortFileList(nodeList: Node[]): Node[] {
	const nodeMap = new Map<string, Node>();
	const childrenMap = new Map<string, Node[]>();

	// Pre-sort nodes by name and type
	nodeList.sort((a, b) => compareNodes(a, b));

	for (const node of nodeList) {
		nodeMap.set(node.fullPath, node);

		const parentPath = node.fullPath.slice(0, node.fullPath.lastIndexOf("/")) || "/";

		if (parentPath !== "/") {
			if (!childrenMap.has(parentPath)) {
				childrenMap.set(parentPath, []);
			}
			childrenMap.get(parentPath)?.push(node);
		}
	}

	const sortedList: Node[] = [];

	const depthFirstTraversal = (path: string): void => {
		const node = nodeMap.get(path);

		if (node) {
			sortedList.push(node);
		}

		const children = childrenMap.get(path);

		if (children) {
			for (const child of children) {
				if (child.kind === "folder") {
					depthFirstTraversal(child.fullPath);
				} else {
					sortedList.push(child);
				}
			}
		}
	};

	// Start with root level items
	const rootItems = nodeList.filter((node) => {
		const parentPath = node.fullPath.slice(0, node.fullPath.lastIndexOf("/")) || "/";
		return parentPath === "/";
	});

	for (const item of rootItems) {
		depthFirstTraversal(item.fullPath);
	}

	return sortedList;
}

function compareNodes(a: Node, b: Node): number {
	if (a.kind !== b.kind) {
		return a.kind === "folder" ? -1 : 1;
	}

	return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}
