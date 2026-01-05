import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileTree } from "./file-tree";
import { ScrollArea } from "./ui/scroll-area";
import { browseFilesystemOptions } from "../api-client/@tanstack/react-query.gen";
import { useFileBrowser } from "../hooks/use-file-browser";

type Props = {
	onSelectPath: (path: string) => void;
	selectedPath?: string;
};

export const DirectoryBrowser = ({ onSelectPath, selectedPath }: Props) => {
	const queryClient = useQueryClient();

	const { data, isLoading } = useQuery({
		...browseFilesystemOptions({ query: { path: "/" } }),
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

	if (fileBrowser.isLoading) {
		return (
			<div className="border rounded-lg overflow-hidden">
				<ScrollArea className="h-64">
					<div className="text-sm text-gray-500 p-4">Loading directories...</div>
				</ScrollArea>
			</div>
		);
	}

	if (fileBrowser.isEmpty) {
		return (
			<div className="border rounded-lg overflow-hidden">
				<ScrollArea className="h-64">
					<div className="text-sm text-gray-500 p-4">No subdirectories found</div>
				</ScrollArea>
			</div>
		);
	}

	return (
		<div className="border rounded-lg overflow-hidden">
			<ScrollArea className="h-64">
				<FileTree
					files={fileBrowser.fileArray}
					onFolderExpand={fileBrowser.handleFolderExpand}
					onFolderHover={fileBrowser.handleFolderHover}
					expandedFolders={fileBrowser.expandedFolders}
					loadingFolders={fileBrowser.loadingFolders}
					foldersOnly
					selectableFolders
					selectedFolder={selectedPath}
					onFolderSelect={onSelectPath}
				/>
			</ScrollArea>

			{selectedPath && (
				<div className="bg-muted/50 border-t p-2 text-sm">
					<div className="font-medium text-muted-foreground">Selected path:</div>
					<div className="font-mono text-xs break-all">{selectedPath}</div>
				</div>
			)}
		</div>
	);
};
