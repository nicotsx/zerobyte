import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listSnapshotFilesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { FileBrowser, type FileBrowserUiProps } from "~/client/components/file-browsers/file-browser";
import { useFileBrowser } from "~/client/hooks/use-file-browser";
import { parseError } from "~/client/lib/errors";
import { isPathWithin, normalizeAbsolutePath } from "@zerobyte/core/utils";
import { ByteSize } from "~/client/components/bytes-size";
import { useTimeFormat } from "~/client/lib/datetime";

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

type SnapshotTreeBrowserProps = FileBrowserUiProps & {
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

	const { selectedPaths, onSelectionChange, onSingleSelectionKindChange, ...fileBrowserUiProps } = uiProps;
	const queryClient = useQueryClient();
	const { formatDateTime } = useTimeFormat();
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

	const fileBrowser = useFileBrowser({
		initialData: data,
		isLoading,
		fetchFolder: async (displayPath, offset = 0) => {
			return await queryClient.ensureQueryData(
				listSnapshotFilesOptions({
					path: { shortId: repositoryId, snapshotId },
					query: { path: displayPath, offset: offset, limit: pageSize },
				}),
			);
		},
		pathTransform: displayPathFns,
	});

	const displayPathKinds = useMemo(() => {
		const kinds = new Map<string, "file" | "dir">();
		for (const entry of fileBrowser.fileArray) {
			kinds.set(entry.path, entry.type === "file" ? "file" : "dir");

			let parentPath = entry.path;
			while (true) {
				const lastSlashIndex = parentPath.lastIndexOf("/");
				if (lastSlashIndex <= 0) {
					break;
				}

				parentPath = parentPath.slice(0, lastSlashIndex);
				if (kinds.has(parentPath)) {
					continue;
				}

				kinds.set(parentPath, "dir");
			}
		}
		return kinds;
	}, [fileBrowser.fileArray]);
	const selectedEntry = fileBrowser.fileArray.find((entry) => entry.path === selectedEntryPath);

	const handleSelectionChange = useCallback(
		(nextDisplayPaths: Set<string>) => {
			if (!onSelectionChange) return;

			const nextFullPaths = new Set<string>();
			for (const displayPath of nextDisplayPaths) {
				nextFullPaths.add(displayPathFns.add(displayPath));
			}

			if (onSingleSelectionKindChange) {
				if (nextDisplayPaths.size === 1) {
					const [selectedDisplayPath] = nextDisplayPaths;
					if (selectedDisplayPath) {
						onSingleSelectionKindChange(displayPathKinds.get(selectedDisplayPath) ?? null);
					} else {
						onSingleSelectionKindChange(null);
					}
				} else {
					onSingleSelectionKindChange(null);
				}
			}

			onSelectionChange(nextFullPaths);
		},
		[displayPathFns, displayPathKinds, onSelectionChange, onSingleSelectionKindChange],
	);

	return (
		<>
			<FileBrowser
				{...fileBrowserUiProps}
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
			{selectedEntry && (
				<div className="border-t bg-muted/30 px-4 py-3" aria-live="polite">
					<div className="mb-2 truncate text-sm font-medium" title={selectedEntry.path}>
						{selectedEntry.path}
					</div>
					<dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
						<div>
							<dt className="text-muted-foreground">Type</dt>
							<dd className="mt-0.5 capitalize">
								{selectedEntry.type === "dir" ? "Directory" : selectedEntry.type}
							</dd>
						</div>
						<div>
							<dt className="text-muted-foreground">Size</dt>
							<dd className="mt-0.5">
								{typeof selectedEntry.size === "number" ? (
									<ByteSize bytes={selectedEntry.size} base={1024} />
								) : (
									"-"
								)}
							</dd>
						</div>
						<div>
							<dt className="text-muted-foreground">Modified</dt>
							<dd className="mt-0.5">
								{selectedEntry.mtime
									? formatDateTime(selectedEntry.mtime)
									: selectedEntry.modifiedAt
										? formatDateTime(selectedEntry.modifiedAt)
										: "-"}
							</dd>
						</div>
						<div>
							<dt className="text-muted-foreground">Permissions</dt>
							<dd className="mt-0.5 font-mono">
								{typeof selectedEntry.mode === "number"
									? (selectedEntry.mode & 0o7777).toString(8).padStart(4, "0")
									: "-"}
							</dd>
						</div>
					</dl>
				</div>
			)}
		</>
	);
};
