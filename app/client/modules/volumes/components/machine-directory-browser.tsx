import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { browseFilesystemOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { FileBrowser } from "~/client/components/file-browsers/file-browser";
import { Button } from "~/client/components/ui/button";
import { useFileBrowser } from "~/client/hooks/use-file-browser";
import { logger } from "~/client/lib/logger";
import { cn } from "~/client/lib/utils";

/** A directory on a machine: an allowed location plus a path inside it ("" is the entire location). */
export type MachineDirectory = { rootId: string; relativePath: string };

type Root = { id: string; label: string };

type Props = {
	agentId: string;
	/** Allowed locations that may be chosen; each is a top-level entry of the tree. */
	roots: Root[];
	value: MachineDirectory | null;
	disabled?: boolean;
	suffix?: ReactNode;
	onChange: (value: MachineDirectory) => void;
};

/** Tree paths are `/<rootId>/<relativePath>`; root IDs never contain a slash. */
const toTreePath = ({ rootId, relativePath }: MachineDirectory) =>
	relativePath ? `/${rootId}/${relativePath}` : `/${rootId}`;

const fromTreePath = (path: string): MachineDirectory => {
	const [rootId = "", ...rest] = path.replace(/^\/+/, "").split("/");
	return { rootId, relativePath: rest.join("/") };
};

export const MachineDirectoryBrowser = ({ agentId, roots, value, disabled, suffix, onChange }: Props) => {
	const [browsing, setBrowsing] = useState(false);
	const rootLabel = roots.find((root) => root.id === value?.rootId)?.label ?? value?.rootId;

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<div className="min-w-0 flex-1 text-sm font-mono bg-muted px-3 py-2 rounded-md border break-all">
					<span className={cn({ hidden: value !== null })}>No directory selected</span>
					<span className={cn({ hidden: value === null || (value.relativePath === "" && !suffix) })}>
						{rootLabel}
						{value?.relativePath ? `/${value.relativePath}` : ""}
						{suffix}
					</span>
					<span className={cn({ hidden: value?.relativePath !== "" || !!suffix })}>Entire {rootLabel}</span>
				</div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={disabled}
					onClick={() => setBrowsing(!browsing)}
				>
					<span className={cn({ hidden: !browsing })}>Cancel</span>
					<span className={cn({ hidden: browsing || value !== null })}>Choose directory</span>
					<span className={cn({ hidden: browsing || value === null })}>Change</span>
				</Button>
			</div>
			{browsing && (
				<RootsTree
					agentId={agentId}
					roots={roots}
					selectedPath={value ? toTreePath(value) : undefined}
					onSelect={(path) => {
						onChange(fromTreePath(path));
						setBrowsing(false);
					}}
				/>
			)}
		</div>
	);
};

type RootsTreeProps = {
	agentId: string;
	roots: Root[];
	selectedPath?: string;
	onSelect: (path: string) => void;
};

const RootsTree = ({ agentId, roots, selectedPath, onSelect }: RootsTreeProps) => {
	const queryClient = useQueryClient();
	// The roots are fixed while the tree is open; a stable reference keeps the hook from re-seeding them.
	const [initialData] = useState(() => ({
		directories: roots.map((root) => ({ name: root.label, path: `/${root.id}` })),
	}));

	const browse = (path: string) => {
		const { rootId, relativePath } = fromTreePath(path);
		return browseFilesystemOptions({ query: { agentId, rootId, path: relativePath } });
	};

	const fileBrowser = useFileBrowser({
		initialData,
		fetchFolder: async (path) => {
			const { rootId } = fromTreePath(path);
			const result = await queryClient.ensureQueryData(browse(path));
			return {
				directories: result.directories.map((directory) => ({
					name: directory.name,
					path: toTreePath({ rootId, relativePath: directory.path.replace(/^\/+/, "") }),
				})),
			};
		},
		prefetchFolder: (path) => {
			void queryClient.prefetchQuery(browse(path)).catch((e) => logger.error(e));
		},
	});

	return (
		<FileBrowser
			className="border rounded-lg overflow-hidden"
			useScrollArea
			scrollAreaClassName="h-64"
			foldersOnly
			selectableFolders
			selectedFolder={selectedPath}
			onFolderSelect={onSelect}
			folderErrors={fileBrowser.folderErrors}
			onFolderRetry={fileBrowser.retryFolder}
			fileArray={fileBrowser.fileArray}
			expandedFolders={fileBrowser.expandedFolders}
			loadingFolders={fileBrowser.loadingFolders}
			onFolderToggle={fileBrowser.handleFolderToggle}
			onFolderHover={fileBrowser.handleFolderHover}
			onLoadMore={fileBrowser.handleLoadMore}
			getFolderPagination={fileBrowser.getFolderPagination}
			isLoading={false}
			isEmpty={fileBrowser.isEmpty}
			emptyMessage="No allowed locations"
		/>
	);
};
