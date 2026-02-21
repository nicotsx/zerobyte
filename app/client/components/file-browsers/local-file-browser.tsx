import { useQuery, useQueryClient } from "@tanstack/react-query";
import { browseFilesystemOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { FileBrowser, type FileBrowserUiProps } from "~/client/components/file-browsers/file-browser";
import { useFileBrowser } from "~/client/hooks/use-file-browser";
import { parseError } from "~/client/lib/errors";
import { normalizeAbsolutePath } from "~/utils/path";

type LocalFileBrowserProps = FileBrowserUiProps & {
	initialPath?: string;
	enabled?: boolean;
};

export const LocalFileBrowser = ({ initialPath = "/", enabled = true, ...uiProps }: LocalFileBrowserProps) => {
	const queryClient = useQueryClient();
	const normalizedInitialPath = normalizeAbsolutePath(initialPath);

	const { data, isLoading, error } = useQuery({
		...browseFilesystemOptions({ query: { path: normalizedInitialPath } }),
		enabled,
	});

	const fileBrowser = useFileBrowser({
		initialData: data,
		isLoading,
		fetchFolder: async (path) => {
			return await queryClient.ensureQueryData(browseFilesystemOptions({ query: { path } }));
		},
		prefetchFolder: (path) => {
			void queryClient.prefetchQuery(browseFilesystemOptions({ query: { path } }));
		},
	});

	const errorDetails = parseError(error)?.message;
	const errorMessage = errorDetails
		? `Failed to load directories: ${errorDetails}`
		: error
			? "Failed to load directories"
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
			loadingMessage={uiProps.loadingMessage ?? "Loading directories..."}
			emptyMessage={uiProps.emptyMessage ?? "No subdirectories found"}
		/>
	);
};
