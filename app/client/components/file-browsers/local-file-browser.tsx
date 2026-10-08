import { useQuery, useQueryClient } from "@tanstack/react-query";
import { browseFilesystemOptions } from "~/client/api-client/@tanstack/react-query.gen";
import type { BrowseFilesystemResponse } from "~/client/api-client/types.gen";
import { FileBrowser, type FileBrowserUiProps } from "~/client/components/file-browsers/file-browser";
import { useFileBrowser } from "~/client/hooks/use-file-browser";
import { parseError } from "~/client/lib/errors";
import { logger } from "~/client/lib/logger";
import { useIsDesktop } from "~/client/hooks/use-is-desktop";
import { FolderAccessError } from "./folder-access-error";

export type TrustedRootRef = { agentId: string; rootId: string };

type LocalFileBrowserProps = FileBrowserUiProps & {
	initialPath?: string;
	enabled?: boolean;
	trustedRoot?: TrustedRootRef;
};

const toLocalBrowserPath = (relativePath: string) => `/${relativePath.replace(/^\/+/, "")}`;

const browseFilesystemAtLocalPath = (localPath: string, trustedRoot?: TrustedRootRef) =>
	browseFilesystemOptions({ query: { path: localPath.slice(1), ...trustedRoot } });

const toLocalBrowserResult = (result: BrowseFilesystemResponse) => ({
	...result,
	path: toLocalBrowserPath(result.path),
	directories: result.directories.map((directory) => ({ ...directory, path: toLocalBrowserPath(directory.path) })),
});

export const LocalFileBrowser = ({
	initialPath = "/",
	enabled = true,
	trustedRoot,
	...uiProps
}: LocalFileBrowserProps) => {
	const queryClient = useQueryClient();
	const isDesktop = useIsDesktop();
	const initialLocalPath = toLocalBrowserPath(initialPath);

	const { data, isLoading, error, refetch } = useQuery({
		...browseFilesystemAtLocalPath(initialLocalPath, trustedRoot),
		enabled,
		select: toLocalBrowserResult,
	});

	const fileBrowser = useFileBrowser({
		initialData: data,
		isLoading,
		fetchFolder: async (path) => {
			const result = await queryClient.ensureQueryData(browseFilesystemAtLocalPath(path, trustedRoot));

			return toLocalBrowserResult(result);
		},
		prefetchFolder: (path) => {
			if (isDesktop) return;

			void queryClient
				.prefetchQuery(browseFilesystemAtLocalPath(path, trustedRoot))
				.catch((e) => logger.error(e));
		},
	});

	return (
		<FileBrowser
			{...uiProps}
			folderErrors={fileBrowser.folderErrors}
			onRetry={() => void refetch()}
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
