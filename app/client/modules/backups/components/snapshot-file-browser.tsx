import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FileIcon } from "lucide-react";
import { FileTree } from "~/client/components/file-tree";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import { Button } from "~/client/components/ui/button";
import { Checkbox } from "~/client/components/ui/checkbox";
import { Label } from "~/client/components/ui/label";
import { Input } from "~/client/components/ui/input";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "~/client/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/client/components/ui/tooltip";
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
	const [showRestoreDialog, setShowRestoreDialog] = useState(false);
	const [deleteExtraFiles, setDeleteExtraFiles] = useState(false);
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [excludeXattr, setExcludeXattr] = useState("");

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

	const handleRestoreClick = useCallback(() => {
		setShowRestoreDialog(true);
	}, []);

	const handleConfirmRestore = useCallback(() => {
		const pathsArray = Array.from(selectedPaths);
		const includePaths = pathsArray.map((path) => addBasePath(path));

		const excludeXattrArray = excludeXattr
			?.split(",")
			.map((s) => s.trim())
			.filter(Boolean);

		restoreSnapshot({
			path: { name: repositoryName },
			body: {
				snapshotId: snapshot.short_id,
				include: includePaths,
				delete: deleteExtraFiles,
				excludeXattr: excludeXattrArray && excludeXattrArray.length > 0 ? excludeXattrArray : undefined,
			},
		});

		setShowRestoreDialog(false);
	}, [selectedPaths, addBasePath, repositoryName, snapshot.short_id, restoreSnapshot, deleteExtraFiles, excludeXattr]);

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
											<Button
												onClick={handleRestoreClick}
												variant="primary"
												size="sm"
												disabled={isRestoring || isReadOnly}
											>
												{isRestoring
													? "Restoring..."
													: `Restore ${selectedPaths.size} selected ${selectedPaths.size === 1 ? "item" : "items"}`}
											</Button>
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

			<AlertDialog open={showRestoreDialog} onOpenChange={setShowRestoreDialog}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Confirm Restore</AlertDialogTitle>
						<AlertDialogDescription>
							{selectedPaths.size > 0
								? `This will restore ${selectedPaths.size} selected ${selectedPaths.size === 1 ? "item" : "items"} from the snapshot.`
								: "This will restore everything from the snapshot."}{" "}
							Existing files will be overwritten by what's in the snapshot. This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="space-y-4">
						<div>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => setShowAdvanced(!showAdvanced)}
								className="h-auto p-0 text-sm font-normal"
							>
								Advanced
								<ChevronDown size={16} className={`ml-1 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
							</Button>

							{showAdvanced && (
								<div className="mt-4 space-y-2">
									<Label htmlFor="exclude-xattr" className="text-sm">
										Exclude Extended Attributes (Optional)
									</Label>
									<Input
										id="exclude-xattr"
										placeholder="com.apple.metadata,user.*,nfs4.*"
										value={excludeXattr}
										onChange={(e) => setExcludeXattr(e.target.value)}
									/>
									<p className="text-xs text-muted-foreground">
										Exclude specific extended attributes during restore (comma-separated)
									</p>
									<div className="flex items-center space-x-2 mt-2">
										<Checkbox
											id="delete-extra"
											checked={deleteExtraFiles}
											onCheckedChange={(checked) => setDeleteExtraFiles(checked === true)}
										/>
										<Label htmlFor="delete-extra" className="text-sm font-normal cursor-pointer">
											Delete files not present in the snapshot?
										</Label>
									</div>
								</div>
							)}
						</div>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={handleConfirmRestore}>Confirm</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
};
