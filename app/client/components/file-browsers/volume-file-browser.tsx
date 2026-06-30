import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listFilesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { FileBrowser, type FileBrowserUiProps } from "~/client/components/file-browsers/file-browser";
import { useFileBrowser, type FetchFolderResult } from "~/client/hooks/use-file-browser";
import { parseError } from "~/client/lib/errors";
import { logger } from "~/client/lib/logger";

type VolumeFileBrowserProps = FileBrowserUiProps & {
	volumeId: string;
	enabled?: boolean;
};

const mapVolumePathSegments = (volumePath: string, transform: (segment: string) => string) => {
	const segments = volumePath.split("/").filter(Boolean).map(transform);
	return segments.length ? `/${segments.join("/")}` : "/";
};

const volumePathTransform = {
	strip: (volumePath: string) => mapVolumePathSegments(volumePath, decodeURIComponent),
	add: (volumePath: string) => mapVolumePathSegments(volumePath, encodeURIComponent),
};

export const VolumeFileBrowser = ({ volumeId, enabled = true, ...uiProps }: VolumeFileBrowserProps) => {
	const queryClient = useQueryClient();

	const { data, isLoading, error } = useQuery({
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
		prefetchFolder: (path) => {
			void queryClient
				.prefetchQuery(
					listFilesOptions({
						path: { shortId: volumeId },
						query: { path },
					}),
				)
				.catch((e) => logger.error(e));
		},
		pathTransform: volumePathTransform,
	});

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
			errorMessage={parseError(error)?.message}
			loadingMessage={uiProps.loadingMessage ?? "Loading files..."}
			emptyMessage={uiProps.emptyMessage ?? "This volume appears to be empty."}
		/>
	);
};
