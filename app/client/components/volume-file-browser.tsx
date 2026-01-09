import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen } from "lucide-react";
import { FileTree } from "~/client/components/file-tree";
import { listFilesOptions } from "../api-client/@tanstack/react-query.gen";
import { useFileBrowser } from "../hooks/use-file-browser";
import { parseError } from "../lib/errors";

type VolumeFileBrowserProps = {
	volumeName: string;
	enabled?: boolean;
	withCheckboxes?: boolean;
	selectedPaths?: Set<string>;
	onSelectionChange?: (paths: Set<string>) => void;
	foldersOnly?: boolean;
	className?: string;
	emptyMessage?: string;
	emptyDescription?: string;
};

export const VolumeFileBrowser = ({
	volumeName,
	enabled = true,
	withCheckboxes = false,
	selectedPaths,
	onSelectionChange,
	foldersOnly = false,
	className,
	emptyMessage = "This volume appears to be empty.",
	emptyDescription,
}: VolumeFileBrowserProps) => {
	const queryClient = useQueryClient();

	const { data, isLoading, error } = useQuery({
		...listFilesOptions({ path: { name: volumeName } }),
		enabled,
	});

	const fileBrowser = useFileBrowser({
		initialData: data,
		isLoading,
		fetchFolder: async (path) => {
			return await queryClient.ensureQueryData(
				listFilesOptions({
					path: { name: volumeName },
					query: { path },
				}),
			);
		},
		prefetchFolder: (path) => {
			void queryClient.prefetchQuery(
				listFilesOptions({
					path: { name: volumeName },
					query: { path },
				}),
			);
		},
	});

	if (fileBrowser.isLoading) {
		return (
			<div className="flex items-center justify-center h-full min-h-50">
				<p className="text-muted-foreground">Loading files...</p>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex items-center justify-center h-full min-h-50">
				<p className="text-destructive">Failed to load files: {parseError(error)?.message}</p>
			</div>
		);
	}

	if (fileBrowser.isEmpty) {
		return (
			<div className="flex flex-col items-center justify-center h-full text-center p-8 min-h-50">
				<FolderOpen className="mb-4 h-12 w-12 text-muted-foreground" />
				<p className="text-muted-foreground">{emptyMessage}</p>
				{emptyDescription && <p className="text-sm text-muted-foreground mt-2">{emptyDescription}</p>}
			</div>
		);
	}

	return (
		<div className={className}>
			<FileTree
				files={fileBrowser.fileArray}
				onFolderExpand={fileBrowser.handleFolderExpand}
				onFolderHover={fileBrowser.handleFolderHover}
				expandedFolders={fileBrowser.expandedFolders}
				loadingFolders={fileBrowser.loadingFolders}
				withCheckboxes={withCheckboxes}
				selectedPaths={selectedPaths}
				onSelectionChange={onSelectionChange}
				foldersOnly={foldersOnly}
			/>
		</div>
	);
};
