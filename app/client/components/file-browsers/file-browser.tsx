import { type ReactNode } from "react";
import { FolderOpen } from "lucide-react";
import { FileTree, type FileEntry } from "~/client/components/file-tree";
import { ScrollArea } from "~/client/components/ui/scroll-area";
import { Button } from "~/client/components/ui/button";
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
	folderErrors: ReadonlyMap<string, string>;
	renderError?: (message: string) => ReactNode;
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

	const body = (
		<>
			<output
				className={cn("flex min-h-50 flex-col items-center justify-center p-6 text-center", stateClassName, {
					hidden: !isLoading,
				})}
				aria-live="polite"
			>
				<p className="text-muted-foreground">{loadingMessage}</p>
			</output>
			<div
				className={cn("flex min-h-50 flex-col items-center justify-center p-6 text-center", stateClassName, {
					hidden: isLoading || !errorMessage,
				})}
			>
				{!isLoading && errorMessage && renderError(errorMessage)}
				<Button
					type="button"
					variant="outline"
					size="sm"
					className={cn("mt-4", { hidden: !onRetry })}
					onClick={onRetry}
				>
					Retry
				</Button>
			</div>
			<output
				className={cn("flex min-h-50 flex-col items-center justify-center p-6 text-center", stateClassName, {
					hidden: isLoading || !!errorMessage || !isEmpty,
				})}
			>
				<FolderOpen
					className={cn("mb-2 h-12 w-12 text-muted-foreground", { hidden: emptyIcon !== undefined })}
				/>
				{emptyIcon}
				<p className="text-muted-foreground">{emptyMessage}</p>
				<p className={cn("mt-2 text-sm text-muted-foreground", { hidden: !emptyDescription })}>
					{emptyDescription}
				</p>
			</output>
			<FileTree
				files={fileArray}
				renderFolderError={(path) => {
					const message = folderErrors.get(path);
					if (!message) return null;

					return (
						<div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
							{renderError(message)}
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
				className={cn(treeClassName, { hidden: isLoading || !!errorMessage || isEmpty })}
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
		</>
	);

	return (
		<div className={className}>
			<div className={treeContainerClassName}>
				{useScrollArea && <ScrollArea className={scrollAreaClassName}>{body}</ScrollArea>}
				{!useScrollArea && body}
			</div>
			<div
				className={cn("bg-muted/50 border-t p-2 text-sm", {
					hidden: !showSelectedPathFooter || !resolvedSelectedPath,
				})}
			>
				<div className="font-medium text-muted-foreground">{selectedPathLabel}</div>
				<div className="font-mono text-xs break-all">{resolvedSelectedPath}</div>
			</div>
		</div>
	);
};
