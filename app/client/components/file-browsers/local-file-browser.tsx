import { useQuery, useQueryClient } from "@tanstack/react-query";
import { browseFilesystemOptions } from "~/client/api-client/@tanstack/react-query.gen";
import type { BrowseFilesystemResponse } from "~/client/api-client/types.gen";
import { FileBrowser, type FileBrowserUiProps } from "~/client/components/file-browsers/file-browser";
import { useFileBrowser } from "~/client/hooks/use-file-browser";
import { parseError } from "~/client/lib/errors";
import { logger } from "~/client/lib/logger";
import { useIsDesktop } from "~/client/hooks/use-is-desktop";
import { FolderAccessError } from "./folder-access-error";

type LocalFileBrowserProps = FileBrowserUiProps & {
	initialPath?: string;
	enabled?: boolean;
};

const toLocalBrowserPath = (relativePath: string) => `/${relativePath.replace(/^\/+/, "")}`;

const browseFilesystemAtLocalPath = (localPath: string) =>
	browseFilesystemOptions({ query: { path: localPath.slice(1) } });

const toLocalBrowserResult = (result: BrowseFilesystemResponse) => ({
	...result,
	path: toLocalBrowserPath(result.path),
	directories: result.directories.map((directory) => ({ ...directory, path: toLocalBrowserPath(directory.path) })),
});

export const LocalFileBrowser = ({ initialPath = "/", enabled = true, ...uiProps }: LocalFileBrowserProps) => {
	const queryClient = useQueryClient();
	const isDesktop = useIsDesktop();
	const initialLocalPath = toLocalBrowserPath(initialPath);

	const { data, isLoading, error } = useQuery({
		...browseFilesystemAtLocalPath(initialLocalPath),
		enabled,
		select: toLocalBrowserResult,
	});

	const fileBrowser = useFileBrowser({
		initialData: data,
		isLoading,
		fetchFolder: async (path) => {
			const result = await queryClient.ensureQueryData(browseFilesystemAtLocalPath(path));

			return toLocalBrowserResult(result);
		},
		prefetchFolder: isDesktop
			? undefined
			: (path) => {
					void queryClient.prefetchQuery(browseFilesystemAtLocalPath(path)).catch((e) => logger.error(e));
				},
	});

	return (
		<FileBrowser
			{...uiProps}
			folderErrors={fileBrowser.folderErrors}
			renderError={(message) => (
				<FolderAccessError
					message={message}
					openPrivacySettings={isDesktop ? window.zerobyteDesktop?.openPrivacySettings : undefined}
				/>
			)}
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
			loadingMessage={uiProps.loadingMessage ?? "Loading directories..."}
			emptyMessage={uiProps.emptyMessage ?? "No subdirectories found"}
		/>
	);
};
