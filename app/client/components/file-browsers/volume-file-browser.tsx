import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listFilesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { FileBrowser, type FileBrowserUiProps } from "~/client/components/file-browsers/file-browser";
import { useFileBrowser, type FetchFolderResult } from "~/client/hooks/use-file-browser";
import { parseError } from "~/client/lib/errors";

type VolumeFileBrowserProps = FileBrowserUiProps & {
	volumeId: string;
	enabled?: boolean;
};

export const VolumeFileBrowser = ({ volumeId, enabled = true, ...uiProps }: VolumeFileBrowserProps) => {
	const queryClient = useQueryClient();

	const { data, isLoading, error } = useQuery({
		...listFilesOptions({ path: { id: volumeId } }),
		enabled,
	});

	const fileBrowser = useFileBrowser({
		initialData: data,
		isLoading,
		fetchFolder: async (path, offset): Promise<FetchFolderResult> => {
			return await queryClient.ensureQueryData(
				listFilesOptions({
					path: { id: volumeId },
					query: { path, offset: offset?.toString() },
				}),
			);
		},
		prefetchFolder: (path) => {
			void queryClient.prefetchQuery(
				listFilesOptions({
					path: { id: volumeId },
					query: { path },
				}),
			);
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
			{...uiProps}
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
			loadingMessage={uiProps.loadingMessage ?? "Loading files..."}
			emptyMessage={uiProps.emptyMessage ?? "This volume appears to be empty."}
		/>
	);
};
