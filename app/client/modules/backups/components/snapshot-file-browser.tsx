import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileIcon } from "lucide-react";
import { FileTree } from "~/client/components/file-tree";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import { Button } from "~/client/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/client/components/ui/tooltip";
import { RestoreSnapshotDialog, type RestoreSnapshotOptions } from "~/client/components/restore-snapshot-dialog";
import type { Snapshot, Volume } from "~/client/lib/types";
import { toast } from "sonner";
import { listSnapshotFilesOptions, restoreSnapshotMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { useFileBrowser } from "~/client/hooks/use-file-browser";

interface Props {
	snapshot: Snapshot;
	repositoryName: string;
	volume?: Volume;
	onDeleteSnapshot?: (snapshotId: string) => void;
	isDeletingSnapshot?: boolean;
}

export const SnapshotFileBrowser = (props: Props) => {
	const { snapshot, repositoryName, volume, onDeleteSnapshot, isDeletingSnapshot } = props;

	const isReadOnly = volume?.config && "readOnly" in volume.config && volume.config.readOnly === true;

	const queryClient = useQueryClient();
	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

	const volumeBasePath = snapshot.paths[0]?.match(/^(.*?_data)(\/|$)/)?.[1] || "/";

	const { data: filesData, isLoading: filesLoading } = useQuery({
		...listSnapshotFilesOptions({
			path: { name: repositoryName, snapshotId: snapshot.short_id },
			query: { path: volumeBasePath },
		}),
	});

	const stripBasePath = useCallback(
		(path: string): string => {
			if (!volumeBasePath) return path;
			if (path === volumeBasePath) return "/";
			if (path.startsWith(`${volumeBasePath}/`)) {
				const stripped = path.slice(volumeBasePath.length);
				return stripped;
			}
			return path;
		},
		[volumeBasePath],
	);

	const addBasePath = useCallback(
		(displayPath: string): string => {
			const vbp = volumeBasePath === "/" ? "" : volumeBasePath;

			if (!vbp) return displayPath;
			if (displayPath === "/") return vbp;
			return `${vbp}${displayPath}`;
		},
		[volumeBasePath],
	);

	const fileBrowser = useFileBrowser({
		initialData: filesData,
		isLoading: filesLoading,
		fetchFolder: async (path) => {
			return await queryClient.ensureQueryData(
				listSnapshotFilesOptions({
					path: { name: repositoryName, snapshotId: snapshot.short_id },
					query: { path },
				}),
			);
		},
		prefetchFolder: (path) => {
			queryClient.prefetchQuery(
				listSnapshotFilesOptions({
					path: { name: repositoryName, snapshotId: snapshot.short_id },
					query: { path },
				}),
			);
		},
		pathTransform: {
			strip: stripBasePath,
			add: addBasePath,
		},
	});

	const { mutate: restoreSnapshot, isPending: isRestoring } = useMutation({
		...restoreSnapshotMutation(),
		onSuccess: (data) => {
			toast.success("Restore completed", {
				description: `Successfully restored ${data.filesRestored} file(s). ${data.filesSkipped} file(s) skipped.`,
			});
			setSelectedPaths(new Set());
		},
		onError: (error) => {
			toast.error("Restore failed", { description: error.message || "Failed to restore snapshot" });
		},
	});

	const handleConfirmRestore = useCallback(
		(options: RestoreSnapshotOptions) => {
			const pathsArray = Array.from(selectedPaths);
			const includePaths = pathsArray.map((path) => addBasePath(path));

			restoreSnapshot({
				path: { name: repositoryName },
				body: {
					snapshotId: snapshot.short_id,
					include: includePaths.length > 0 ? includePaths : undefined,
					delete: options.delete,
					excludeXattr: options.excludeXattr,
					targetPath: options.targetPath,
					overwrite: options.overwrite,
				},
			});
		},
		[selectedPaths, addBasePath, repositoryName, snapshot.short_id, restoreSnapshot],
	);

	return (
		<div className="space-y-4">
			<Card className="h-[600px] flex flex-col">
				<CardHeader>
					<div className="flex items-start justify-between">
						<div>
							<CardTitle>File Browser</CardTitle>
							<CardDescription>{`Viewing snapshot from ${new Date(snapshot?.time ?? 0).toLocaleString()}`}</CardDescription>
						</div>
						<div className="flex gap-2">
							{selectedPaths.size > 0 && (
								<Tooltip>
									<TooltipTrigger asChild>
										<span tabIndex={isReadOnly ? 0 : undefined}>
											<RestoreSnapshotDialog
												selectedCount={selectedPaths.size}
												onConfirm={handleConfirmRestore}
												trigger={
													<Button variant="primary" size="sm" disabled={isRestoring || isReadOnly}>
														{isRestoring
															? "Restoring..."
															: `Restore ${selectedPaths.size} selected ${selectedPaths.size === 1 ? "item" : "items"}`}
													</Button>
												}
											/>
										</span>
									</TooltipTrigger>
									{isReadOnly && (
										<TooltipContent className="text-center">
											<p>Volume is mounted as read-only.</p>
											<p>Please remount with read-only disabled to restore files.</p>
										</TooltipContent>
									)}
								</Tooltip>
							)}
							{onDeleteSnapshot && (
								<Button
									variant="destructive"
									size="sm"
									onClick={() => onDeleteSnapshot(snapshot.short_id)}
									disabled={isDeletingSnapshot}
									loading={isDeletingSnapshot}
								>
									{isDeletingSnapshot ? "Deleting..." : "Delete Snapshot"}
								</Button>
							)}
						</div>
					</div>
				</CardHeader>
				<CardContent className="flex-1 overflow-hidden flex flex-col p-0">
					{fileBrowser.isLoading && (
						<div className="flex items-center justify-center flex-1">
							<p className="text-muted-foreground">Loading files...</p>
						</div>
					)}

					{fileBrowser.isEmpty && (
						<div className="flex flex-col items-center justify-center flex-1 text-center p-8">
							<FileIcon className="w-12 h-12 text-muted-foreground/50 mb-4" />
							<p className="text-muted-foreground">No files in this snapshot</p>
						</div>
					)}

					{!fileBrowser.isLoading && !fileBrowser.isEmpty && (
						<div className="overflow-auto flex-1 border border-border rounded-md bg-card m-4">
							<FileTree
								files={fileBrowser.fileArray}
								onFolderExpand={fileBrowser.handleFolderExpand}
								onFolderHover={fileBrowser.handleFolderHover}
								expandedFolders={fileBrowser.expandedFolders}
								loadingFolders={fileBrowser.loadingFolders}
								className="px-2 py-2"
								withCheckboxes={true}
								selectedPaths={selectedPaths}
								onSelectionChange={setSelectedPaths}
							/>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
};
