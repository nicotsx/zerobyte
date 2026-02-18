import { LocalFileBrowser } from "./local-file-browser";

type Props = {
	onSelectPath: (path: string) => void;
	selectedPath?: string;
};

export const DirectoryBrowser = ({ onSelectPath, selectedPath }: Props) => {
	return (
		<LocalFileBrowser
			className="border rounded-lg overflow-hidden"
			useScrollArea
			scrollAreaClassName="h-64"
			foldersOnly
			selectableFolders
			selectedFolder={selectedPath}
			onFolderSelect={onSelectPath}
			showSelectedPathFooter
			selectedPath={selectedPath}
			loadingMessage="Loading directories..."
			emptyMessage="No subdirectories found"
		/>
	);
};
