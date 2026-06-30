import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listSnapshotFilesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { FileBrowser, type FileBrowserUiProps } from "~/client/components/file-browsers/file-browser";
import { useFileBrowser } from "~/client/hooks/use-file-browser";
import { parseError } from "~/client/lib/errors";
import { createSnapshotPathContext } from "@zerobyte/core/restic";

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
	const snapshotPathContext = useMemo(
		() => createSnapshotPathContext({ snapshotPaths: [queryBasePath], displayBasePath }),
		[displayBasePath, queryBasePath],
	);
	const normalizedQueryBasePath = snapshotPathContext.browser.initialQueryPath();

	const { data, isLoading, error } = useQuery({
		...listSnapshotFilesOptions({
			path: { shortId: repositoryId, snapshotId },
			query: { path: normalizedQueryBasePath },
		}),
		enabled,
	});

	const displayPathFns = useMemo(
		() => ({
			strip: snapshotPathContext.browser.toDisplayPath,
			add: snapshotPathContext.browser.toSnapshotPath,
		}),
		[snapshotPathContext],
	);

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
		<FileBrowser
			{...fileBrowserUiProps}
			fileArray={fileBrowser.fileArray}
			expandedFolders={fileBrowser.expandedFolders}
			loadingFolders={fileBrowser.loadingFolders}
			onFolderExpand={fileBrowser.handleFolderExpand}
			onFolderHover={fileBrowser.handleFolderHover}
			onLoadMore={fileBrowser.handleLoadMore}
			getFolderPagination={fileBrowser.getFolderPagination}
			isLoading={fileBrowser.isLoading}
			isEmpty={fileBrowser.isEmpty}
			errorMessage={parseError(error)?.message}
			loadingMessage={fileBrowserUiProps.loadingMessage ?? "Loading files..."}
			selectedPaths={displaySelectedPaths}
			onSelectionChange={onSelectionChange ? handleSelectionChange : undefined}
		/>
	);
};
