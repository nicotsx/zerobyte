import { type ReactNode } from "react";
import { FolderOpen } from "lucide-react";
import { FileTree, type FileEntry } from "~/client/components/file-tree";
import { ScrollArea } from "~/client/components/ui/scroll-area";
import { cn } from "~/client/lib/utils";

type PaginationState = {
	hasMore: boolean;
	isLoadingMore: boolean;
};

export type FileBrowserUiProps = {
	className?: string;
	treeContainerClassName?: string;
	treeClassName?: string;
	useScrollArea?: boolean;
	scrollAreaClassName?: string;
	stateClassName?: string;
	loadingMessage?: string;
	emptyMessage?: string;
	emptyDescription?: string;
	emptyIcon?: ReactNode;
	withCheckboxes?: boolean;
	selectedPaths?: Set<string>;
	onSelectionChange?: (paths: Set<string>) => void;
	foldersOnly?: boolean;
	selectableFolders?: boolean;
	onFolderSelect?: (folderPath: string) => void;
	selectedFolder?: string;
	onFileSelect?: (filePath: string) => void;
	selectedFile?: string;
	showSelectedPathFooter?: boolean;
	selectedPath?: string;
	selectedPathLabel?: string;
};

type FileBrowserProps = FileBrowserUiProps & {
	isLoading: boolean;
	isEmpty: boolean;
	errorMessage?: string;
	fileArray: FileEntry[];
	expandedFolders: Set<string>;
	loadingFolders: Set<string>;
	onFolderExpand: (folderPath: string) => void | Promise<void>;
	onFolderHover: (folderPath: string) => void;
	onLoadMore: (folderPath: string) => void | Promise<void>;
	getFolderPagination: (folderPath: string) => PaginationState;
};

export const FileBrowser = (props: FileBrowserProps) => {
	const {
		className,
		treeContainerClassName,
		treeClassName,
		useScrollArea = false,
		scrollAreaClassName,
		stateClassName,
		loadingMessage = "Loading files...",
		emptyMessage = "No files found.",
		emptyDescription,
		emptyIcon,
		withCheckboxes = false,
		selectedPaths,
		onSelectionChange,
		foldersOnly = false,
		selectableFolders = false,
		onFolderSelect,
		selectedFolder,
		onFileSelect,
		selectedFile,
		showSelectedPathFooter = false,
		selectedPath,
		selectedPathLabel = "Selected path:",
		isLoading,
		isEmpty,
		errorMessage,
		fileArray,
		expandedFolders,
		loadingFolders,
		onFolderExpand,
		onFolderHover,
		onLoadMore,
		getFolderPagination,
	} = props;

	const resolvedSelectedPath = selectedPath ?? selectedFolder;
	const resolvedEmptyIcon =
		emptyIcon === undefined ? <FolderOpen className="mb-2 h-12 w-12 text-muted-foreground" /> : emptyIcon;

	let body: ReactNode;

	if (isLoading) {
		body = (
			<div className={cn("flex min-h-50 flex-col items-center justify-center p-6 text-center", stateClassName)}>
				<p className="text-muted-foreground">{loadingMessage}</p>
			</div>
		);
	} else if (errorMessage) {
		body = (
			<div className={cn("flex min-h-50 flex-col items-center justify-center p-6 text-center", stateClassName)}>
				<p className="text-destructive">{errorMessage}</p>
			</div>
		);
	} else if (isEmpty) {
		body = (
			<div className={cn("flex min-h-50 flex-col items-center justify-center p-6 text-center", stateClassName)}>
				{resolvedEmptyIcon}
				<p className="text-muted-foreground">{emptyMessage}</p>
				{emptyDescription && <p className="mt-2 text-sm text-muted-foreground">{emptyDescription}</p>}
			</div>
		);
	} else {
		body = (
			<FileTree
				files={fileArray}
				onFolderExpand={onFolderExpand}
				onFolderHover={onFolderHover}
				onLoadMore={onLoadMore}
				getFolderPagination={getFolderPagination}
				expandedFolders={expandedFolders}
				loadingFolders={loadingFolders}
				className={treeClassName}
				withCheckboxes={withCheckboxes}
				selectedPaths={selectedPaths}
				onSelectionChange={onSelectionChange}
				foldersOnly={foldersOnly}
				selectableFolders={selectableFolders}
				onFolderSelect={onFolderSelect}
				selectedFolder={selectedFolder}
				onFileSelect={onFileSelect}
				selectedFile={selectedFile}
			/>
		);
	}

	const bodyWithScroll = useScrollArea ? <ScrollArea className={scrollAreaClassName}>{body}</ScrollArea> : body;
	const wrappedBody = treeContainerClassName ? (
		<div className={treeContainerClassName}>{bodyWithScroll}</div>
	) : (
		bodyWithScroll
	);

	return (
		<div className={className}>
			{wrappedBody}
			{showSelectedPathFooter && resolvedSelectedPath && (
				<div className="bg-muted/50 border-t p-2 text-sm">
					<div className="font-medium text-muted-foreground">{selectedPathLabel}</div>
					<div className="font-mono text-xs break-all">{resolvedSelectedPath}</div>
				</div>
			)}
		</div>
	);
};
