import { LocalFileBrowser, type TrustedRootRef } from "./local-file-browser";

type Props = {
	onSelectPath: (path: string) => void;
	selectedPath?: string;
	trustedRoot?: TrustedRootRef;
};

export const DirectoryBrowser = ({ onSelectPath, selectedPath, trustedRoot }: Props) => {
	return (
		<LocalFileBrowser
			trustedRoot={trustedRoot}
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
