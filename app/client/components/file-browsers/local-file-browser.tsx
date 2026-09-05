import { Button } from "~/client/components/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { decodeTrustedPathPresentation } from "@zerobyte/contracts/volumes";
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
	remote?: { agentId: string; rootId: string };
};

const toLocalBrowserPath = (presentedPath: string) => {
	const logicalPath = decodeTrustedPathPresentation(presentedPath);

	return `/${logicalPath}`;
};

const browseFilesystemAtLocalPath = (localPath: string, remote?: { agentId: string; rootId: string }) => {
	const path = localPath.slice(1);

	return browseFilesystemOptions({ query: { path, ...remote } });
};

const toLocalBrowserResult = (result: BrowseFilesystemResponse) => {
	const directories = result.directories.map((directory) => {
		const path = toLocalBrowserPath(directory.path);

		return { ...directory, path };
	});

	const path = toLocalBrowserPath(result.path);

	return { ...result, path, directories };
};

export const LocalFileBrowser = ({ initialPath = "/", enabled = true, remote, ...uiProps }: LocalFileBrowserProps) => {
	const queryClient = useQueryClient();
	const isDesktop = useIsDesktop();

	const initialLocalPath = toLocalBrowserPath(initialPath);
	const initialBrowseOptions = browseFilesystemAtLocalPath(initialLocalPath, remote);

	const { data, isLoading, error } = useQuery({
		...initialBrowseOptions,
		enabled,
		select: toLocalBrowserResult,
	});

	const fileBrowser = useFileBrowser({
		initialData: data,
		isLoading,
		fetchFolder: async (path) => {
			const browseOptions = browseFilesystemAtLocalPath(path, remote);
			const result = await queryClient.ensureQueryData(browseOptions);
			return toLocalBrowserResult(result);
		},
		prefetchFolder: isDesktop
			? undefined
			: (path) => {
					const browseOptions = browseFilesystemAtLocalPath(path, remote);
					void queryClient.prefetchQuery(browseOptions).catch((e) => logger.error(e));
				},
	});

	return (
		<div className="space-y-2">
			{remote && data && !error && uiProps.onFolderSelect && (
				<Button type="button" variant="outline" size="sm" onClick={() => uiProps.onFolderSelect?.("/")}>
					Select entire location
				</Button>
			)}
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
		</div>
	);
};
