import { useQuery, useQueryClient } from "@tanstack/react-query";
import { decodeTrustedPathPresentation } from "@zerobyte/contracts/volumes";
import { browseFilesystemOptions } from "~/client/api-client/@tanstack/react-query.gen";
import type { BrowseFilesystemResponse } from "~/client/api-client/types.gen";
import { FileBrowser, type FileBrowserUiProps } from "~/client/components/file-browsers/file-browser";
import { useFileBrowser } from "~/client/hooks/use-file-browser";
import { parseError } from "~/client/lib/errors";
import { normalizeAbsolutePath } from "@zerobyte/core/utils";
import { logger } from "~/client/lib/logger";
import { useIsDesktop } from "~/client/hooks/use-is-desktop";
import { FolderAccessError } from "./folder-access-error";

type LocalFileBrowserProps = FileBrowserUiProps & {
	initialPath?: string;
	enabled?: boolean;
};

const toLocalBrowserPath = (presentedPath: string) => {
	const logicalPath = decodeTrustedPathPresentation(presentedPath);
	return normalizeAbsolutePath(logicalPath);
};

const browseFilesystemAtLocalPath = (presentedPath: string) => {
	const path = toLocalBrowserPath(presentedPath);
	return browseFilesystemOptions({ query: { path } });
};

const toLocalBrowserResult = (result: BrowseFilesystemResponse) => {
	const directories = result.directories.map((directory) => {
		const path = toLocalBrowserPath(directory.path);
		return { ...directory, path };
	});
	const path = toLocalBrowserPath(result.path);
	return { ...result, path, directories };
};

export const LocalFileBrowser = ({ initialPath = "/", enabled = true, ...uiProps }: LocalFileBrowserProps) => {
	const queryClient = useQueryClient();
	const isDesktop = useIsDesktop();
	const initialBrowseOptions = browseFilesystemAtLocalPath(initialPath);

	const { data, isLoading, error } = useQuery({
		...initialBrowseOptions,
		enabled,
		select: toLocalBrowserResult,
	});

	const fileBrowser = useFileBrowser({
		initialData: data,
		isLoading,
		fetchFolder: async (path) => {
			const browseOptions = browseFilesystemAtLocalPath(path);
			const result = await queryClient.ensureQueryData(browseOptions);
			return toLocalBrowserResult(result);
		},
		prefetchFolder: isDesktop
			? undefined
			: (path) => {
					const browseOptions = browseFilesystemAtLocalPath(path);
					void queryClient.prefetchQuery(browseOptions).catch((e) => logger.error(e));
				},
	});

	return (
		<FileBrowser
			{...uiProps}
			folderErrors={fileBrowser.folderErrors}
			onFolderRetry={fileBrowser.retryFolder}
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
