import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listSnapshotFilesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { FileBrowser, type FileBrowserUiProps } from "~/client/components/file-browsers/file-browser";
import { useFileBrowser } from "~/client/hooks/use-file-browser";
import { parseError } from "~/client/lib/errors";

const normalizeAbsolutePath = (path?: string): string => {
	if (!path) return "/";
	const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
	const trimmed = withLeadingSlash.replace(/\/+$/, "");
	return trimmed || "/";
};

type SnapshotTreeBrowserProps = FileBrowserUiProps & {
	repositoryId: string;
	snapshotId: string;
	basePath?: string;
	pageSize?: number;
	enabled?: boolean;
};

export const SnapshotTreeBrowser = ({
	repositoryId,
	snapshotId,
	basePath = "/",
	pageSize = 500,
	enabled = true,
	...uiProps
}: SnapshotTreeBrowserProps) => {
	const { selectedPaths, onSelectionChange, ...fileBrowserUiProps } = uiProps;
	const queryClient = useQueryClient();
	const normalizedBasePath = normalizeAbsolutePath(basePath);

	const { data, isLoading, error } = useQuery({
		...listSnapshotFilesOptions({
			path: { id: repositoryId, snapshotId },
			query: { path: normalizedBasePath },
		}),
		enabled,
	});

	const stripBasePath = useCallback(
		(path: string): string => {
			if (normalizedBasePath === "/") return path;
			if (path === normalizedBasePath) return "/";
			if (path.startsWith(`${normalizedBasePath}/`)) {
				return path.slice(normalizedBasePath.length);
			}
			return path;
		},
		[normalizedBasePath],
	);

	const addBasePath = useCallback(
		(displayPath: string): string => {
			if (normalizedBasePath === "/") return displayPath;
			if (displayPath === "/") return normalizedBasePath;
			return `${normalizedBasePath}${displayPath}`;
		},
		[normalizedBasePath],
	);

	const displaySelectedPaths = useMemo(() => {
		if (!selectedPaths) return undefined;

		const displayPaths = new Set<string>();
		for (const fullPath of selectedPaths) {
			displayPaths.add(stripBasePath(fullPath));
		}

		return displayPaths;
	}, [selectedPaths, stripBasePath]);

	const handleSelectionChange = useCallback(
		(nextDisplayPaths: Set<string>) => {
			if (!onSelectionChange) return;

			const nextFullPaths = new Set<string>();
			for (const displayPath of nextDisplayPaths) {
				nextFullPaths.add(addBasePath(displayPath));
			}

			onSelectionChange(nextFullPaths);
		},
		[onSelectionChange, addBasePath],
	);

	const fileBrowser = useFileBrowser({
		initialData: data,
		isLoading,
		fetchFolder: async (path, offset = 0) => {
			return await queryClient.ensureQueryData(
				listSnapshotFilesOptions({
					path: { id: repositoryId, snapshotId },
					query: {
						path,
						offset: offset.toString(),
						limit: pageSize.toString(),
					},
				}),
			);
		},
		prefetchFolder: (path) => {
			void queryClient.prefetchQuery(
				listSnapshotFilesOptions({
					path: { id: repositoryId, snapshotId },
					query: {
						path,
						offset: "0",
						limit: pageSize.toString(),
					},
				}),
			);
		},
		pathTransform: {
			strip: stripBasePath,
			add: addBasePath,
		},
	});

	const errorDetails = parseError(error)?.message;
	const errorMessage = errorDetails
		? `Failed to load files: ${errorDetails}`
		: error
			? "Failed to load files"
			: undefined;

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
			errorMessage={errorMessage}
			loadingMessage={fileBrowserUiProps.loadingMessage ?? "Loading files..."}
			selectedPaths={displaySelectedPaths}
			onSelectionChange={onSelectionChange ? handleSelectionChange : undefined}
		/>
	);
};
