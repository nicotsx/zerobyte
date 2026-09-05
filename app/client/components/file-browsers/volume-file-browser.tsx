import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listFilesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { FileBrowser, type FileBrowserUiProps } from "~/client/components/file-browsers/file-browser";
import { useFileBrowser, type FetchFolderResult } from "~/client/hooks/use-file-browser";
import { parseError } from "~/client/lib/errors";
import { logger } from "~/client/lib/logger";
import { useIsDesktop } from "~/client/hooks/use-is-desktop";
import { FolderAccessError } from "./folder-access-error";

type VolumeFileBrowserProps = FileBrowserUiProps & {
	volumeId: string;
	enabled?: boolean;
	requestErrorMessage?: string;
};

export const VolumeFileBrowser = ({
	volumeId,
	enabled = true,
	requestErrorMessage,
	...uiProps
}: VolumeFileBrowserProps) => {
	const queryClient = useQueryClient();
	const isDesktop = useIsDesktop();

	const { data, isLoading, error, refetch } = useQuery({
		...listFilesOptions({ path: { shortId: volumeId } }),
		enabled,
	});

	const fileBrowser = useFileBrowser({
		initialData: data,
		isLoading,
		fetchFolder: async (path, offset): Promise<FetchFolderResult> => {
			return await queryClient.ensureQueryData(
				listFilesOptions({
					path: { shortId: volumeId },
					query: { path, offset: offset },
				}),
			);
		},
		prefetchFolder: isDesktop
			? undefined
			: (path) => {
					void queryClient
						.prefetchQuery(
							listFilesOptions({
								path: { shortId: volumeId },
								query: { path },
							}),
						)
						.catch((e) => logger.error(e));
				},
	});

	const genericNestedRequestErrorMessage = "Files could not be loaded. Try again.";
	const parsedErrorMessage = parseError(error)?.message;
	const errorMessage = error ? (requestErrorMessage ?? parsedErrorMessage) : undefined;

	const renderError = (message: string) => (
		<FolderAccessError
			message={message}
			openPrivacySettings={isDesktop ? window.zerobyteDesktop?.openPrivacySettings : undefined}
		/>
	);

	return (
		<FileBrowser
			{...uiProps}
			folderErrors={fileBrowser.folderErrors}
			onFolderRetry={fileBrowser.retryFolder}
			renderError={renderError}
			renderFolderError={(message) => {
				const denied = /\b(EPERM|EACCES)\b/.test(message);
				return renderError(requestErrorMessage ?? (denied ? message : genericNestedRequestErrorMessage));
			}}
			fileArray={fileBrowser.fileArray}
			expandedFolders={fileBrowser.expandedFolders}
			loadingFolders={fileBrowser.loadingFolders}
			onFolderToggle={fileBrowser.handleFolderToggle}
			onFolderHover={fileBrowser.handleFolderHover}
			onLoadMore={fileBrowser.handleLoadMore}
			getFolderPagination={fileBrowser.getFolderPagination}
			isLoading={fileBrowser.isLoading}
			isEmpty={fileBrowser.isEmpty}
			errorMessage={errorMessage}
			onRetry={async () => {
				await refetch();
			}}
			loadingMessage={uiProps.loadingMessage ?? "Loading files..."}
			emptyMessage={uiProps.emptyMessage ?? "This source appears to be empty."}
		/>
	);
};
