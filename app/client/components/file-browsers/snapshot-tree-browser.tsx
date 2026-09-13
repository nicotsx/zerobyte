import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listSnapshotFilesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { FileBrowser, type FileBrowserUiProps } from "~/client/components/file-browsers/file-browser";
import { useFileBrowser } from "~/client/hooks/use-file-browser";
import { parseError } from "~/client/lib/errors";
import { isPathWithin, normalizeAbsolutePath } from "@zerobyte/core/utils";
import type { ListSnapshotFilesResponse } from "~/client/api-client";
import { buildFileEntryMap } from "~/client/components/file-tree-model";
import { SnapshotEntryDetails } from "./snapshot-entry-details";

function toBrowserFiles(data: ListSnapshotFilesResponse) {
	return {
		...data,
		files: data.files.map(({ mtime, ...file }) => ({
			...file,
			modifiedAt: mtime === undefined ? undefined : new Date(mtime).getTime(),
		})),
	};
}

function createPathPrefixFns(basePath: string) {
	return {
		strip(path: string) {
			if (basePath === "/") return path;
			if (path === basePath) return "/";
			if (path.startsWith(`${basePath}/`)) return path.slice(basePath.length);
			return path;
		},
		add(displayPath: string) {
			if (basePath === "/") return displayPath;
			if (displayPath === "/") return basePath;
			return `${basePath}${displayPath}`;
		},
	};
}

type SnapshotTreeBrowserProps = Omit<
	FileBrowserUiProps,
	| "selectableFolders"
	| "selectedFile"
	| "selectedFolder"
	| "onFileSelect"
	| "onFolderSelect"
	| "showSelectedPathFooter"
	| "selectedPath"
	| "selectedPathLabel"
> & {
	repositoryId: string;
	snapshotId: string;
	queryBasePath?: string;
	displayBasePath?: string;
	pageSize?: number;
	enabled?: boolean;
	onSingleSelectionKindChange?: (kind: "file" | "dir" | null) => void;
};

export const SnapshotTreeBrowser = (props: SnapshotTreeBrowserProps) => {
	const {
		repositoryId,
		snapshotId,
		queryBasePath = "/",
		displayBasePath,
		pageSize = 500,
		enabled = true,
		...uiProps
	} = props;

	const { className, selectedPaths, onSelectionChange, onSingleSelectionKindChange, ...fileBrowserUiProps } = uiProps;
	const queryClient = useQueryClient();
	const [selectedEntryPath, setSelectedEntryPath] = useState<string>();
	const normalizedQueryBasePath = normalizeAbsolutePath(queryBasePath);
	const normalizedDisplayBasePath = normalizeAbsolutePath(displayBasePath ?? "/");
	const effectiveDisplayBasePath = isPathWithin(normalizedDisplayBasePath, normalizedQueryBasePath)
		? normalizedDisplayBasePath
		: "/";

	const { data, isLoading, error } = useQuery({
		...listSnapshotFilesOptions({
			path: { shortId: repositoryId, snapshotId },
			query: { path: normalizedQueryBasePath },
		}),
		enabled,
	});

	const displayPathFns = useMemo(() => createPathPrefixFns(effectiveDisplayBasePath), [effectiveDisplayBasePath]);

	const displaySelectedPaths = useMemo(() => {
		if (!selectedPaths) return undefined;

		const displayPaths = new Set<string>();
		for (const fullPath of selectedPaths) {
			displayPaths.add(displayPathFns.strip(fullPath));
		}

		return displayPaths;
	}, [displayPathFns, selectedPaths]);

	const initialData = useMemo(() => data && toBrowserFiles(data), [data]);
	const fileBrowser = useFileBrowser({
		initialData,
		isLoading,
		fetchFolder: async (displayPath, offset = 0) => {
			return toBrowserFiles(
				await queryClient.ensureQueryData(
					listSnapshotFilesOptions({
						path: { shortId: repositoryId, snapshotId },
						query: { path: displayPath, offset: offset, limit: pageSize },
					}),
				),
			);
		},
		pathTransform: displayPathFns,
	});

	const entries = useMemo(() => buildFileEntryMap(fileBrowser.fileArray), [fileBrowser.fileArray]);
	const selectedEntry = selectedEntryPath === undefined ? undefined : entries.get(selectedEntryPath);

	const handleSelectionChange = useCallback(
		(nextDisplayPaths: Set<string>) => {
			if (!onSelectionChange) return;

			const nextFullPaths = new Set<string>();
			for (const displayPath of nextDisplayPaths) {
				nextFullPaths.add(displayPathFns.add(displayPath));
			}

			const [path] = nextDisplayPaths;
			const entry = nextDisplayPaths.size === 1 && path !== undefined ? entries.get(path) : undefined;
			onSingleSelectionKindChange?.(entry ? (entry.type === "file" ? "file" : "dir") : null);

			onSelectionChange(nextFullPaths);
		},
		[displayPathFns, entries, onSelectionChange, onSingleSelectionKindChange],
	);

	return (
		<div className={`flex min-h-0 flex-1 flex-col ${className ?? ""}`}>
			<FileBrowser
				{...fileBrowserUiProps}
				className="flex flex-1 min-h-0 flex-col"
				folderErrors={fileBrowser.folderErrors}
				fileArray={fileBrowser.fileArray}
				expandedFolders={fileBrowser.expandedFolders}
				loadingFolders={fileBrowser.loadingFolders}
				onFolderToggle={fileBrowser.handleFolderToggle}
				onFolderHover={fileBrowser.handleFolderHover}
				onLoadMore={fileBrowser.handleLoadMore}
				getFolderPagination={fileBrowser.getFolderPagination}
				isLoading={fileBrowser.isLoading}
				isEmpty={fileBrowser.isEmpty}
				errorMessage={parseError(error)?.message}
				loadingMessage={fileBrowserUiProps.loadingMessage ?? "Loading files..."}
				selectedPaths={displaySelectedPaths}
				onSelectionChange={onSelectionChange ? handleSelectionChange : undefined}
				selectableFolders
				selectedFile={selectedEntry?.type === "file" ? selectedEntryPath : undefined}
				selectedFolder={selectedEntry && selectedEntry.type !== "file" ? selectedEntryPath : undefined}
				onFileSelect={setSelectedEntryPath}
				onFolderSelect={setSelectedEntryPath}
			/>
			{selectedEntry && <SnapshotEntryDetails entry={selectedEntry} />}
		</div>
	);
};
