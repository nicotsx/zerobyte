import { type ReactNode } from "react";
import { FolderOpen } from "lucide-react";
import { FileTree, type FileEntry } from "~/client/components/file-tree";
import { ScrollArea } from "~/client/components/ui/scroll-area";
import { Button } from "~/client/components/ui/button";
import { cn } from "~/client/lib/utils";
import type { FolderFailure } from "~/client/hooks/use-file-browser";

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
	folderErrors: ReadonlyMap<string, FolderFailure>;
	renderError?: (message: string) => ReactNode;
	renderFolderError?: (message: string) => ReactNode;
	onRetry?: () => void | Promise<void>;
	onFolderRetry: (path: string) => void | Promise<void>;
	fileArray: FileEntry[];
	expandedFolders: Set<string>;
	loadingFolders: Set<string>;
	onFolderToggle: (folderPath: string, expanded: boolean) => void | Promise<void>;
	onFolderHover: (folderPath: string) => void;
	onLoadMore: (folderPath: string) => void | Promise<void>;
	getFolderPagination: (folderPath: string) => PaginationState;
};

const renderDefaultError = (message: string) => (
	<p role="alert" className="text-destructive">
		{message}
	</p>
);

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
		folderErrors,
		renderError = renderDefaultError,
		renderFolderError = renderError,
		onRetry,
		onFolderRetry,
		fileArray,
		expandedFolders,
		loadingFolders,
		onFolderToggle,
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
			<output
				className={cn("flex min-h-50 flex-col items-center justify-center p-6 text-center", stateClassName)}
				aria-live="polite"
			>
				<p className="text-muted-foreground">{loadingMessage}</p>
			</output>
		);
	} else if (errorMessage) {
		body = (
			<div className={cn("flex min-h-50 flex-col items-center justify-center p-6 text-center", stateClassName)}>
				{renderError(errorMessage)}
				{onRetry && (
					<Button type="button" variant="outline" size="sm" className="mt-4" onClick={onRetry}>
						Retry
					</Button>
				)}
			</div>
		);
	} else if (isEmpty) {
		body = (
			<output
				className={cn("flex min-h-50 flex-col items-center justify-center p-6 text-center", stateClassName)}
			>
				{resolvedEmptyIcon}
				<p className="text-muted-foreground">{emptyMessage}</p>
				{emptyDescription && <p className="mt-2 text-sm text-muted-foreground">{emptyDescription}</p>}
			</output>
		);
	} else {
		body = (
			<FileTree
				files={fileArray}
				renderFolderError={(path) => {
					const failure = folderErrors.get(path);
					if (!failure) return null;

					return (
						<div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
							{renderFolderError(failure.message)}
							<button
								type="button"
								aria-label={`Retry ${path}`}
								className="cursor-pointer text-xs text-destructive underline underline-offset-2 normal-case"
								onClick={() => void onFolderRetry(path)}
							>
								Retry
							</button>
						</div>
					);
				}}
				onFolderToggle={onFolderToggle}
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

	return (
		<div className={className}>
			<div className={treeContainerClassName}>{bodyWithScroll}</div>
			{showSelectedPathFooter && resolvedSelectedPath && (
				<div className="bg-muted/50 border-t p-2 text-sm">
					<div className="font-medium text-muted-foreground">{selectedPathLabel}</div>
					<div className="font-mono text-xs break-all">{resolvedSelectedPath}</div>
				</div>
			)}
		</div>
	);
};
