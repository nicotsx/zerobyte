import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FileIcon, FolderOpen, RotateCcw } from "lucide-react";
import { FileTree } from "~/client/components/file-tree";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import { Button } from "~/client/components/ui/button";
import { Checkbox } from "~/client/components/ui/checkbox";
import { Label } from "~/client/components/ui/label";
import { Input } from "~/client/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
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
import { PathSelector } from "~/client/components/path-selector";
import type { Snapshot, Volume } from "~/client/lib/types";
import { toast } from "sonner";
import { listSnapshotFilesOptions, restoreSnapshotMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { useFileBrowser } from "~/client/hooks/use-file-browser";
import { OVERWRITE_MODES, type OverwriteMode } from "~/schemas/restic";

type RestoreLocation = "original" | "custom";

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
	const [restoreLocation, setRestoreLocation] = useState<RestoreLocation>("original");
	const [customTargetPath, setCustomTargetPath] = useState("");
	const [overwriteMode, setOverwriteMode] = useState<OverwriteMode>("always");

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

		const isCustomLocation = restoreLocation === "custom";
		const targetPath = isCustomLocation && customTargetPath.trim() ? customTargetPath.trim() : undefined;

		restoreSnapshot({
			path: { name: repositoryName },
			body: {
				snapshotId: snapshot.short_id,
				target: targetPath || undefined,
				include: includePaths,
				delete: deleteExtraFiles,
				excludeXattr: excludeXattrArray && excludeXattrArray.length > 0 ? excludeXattrArray : undefined,
				targetPath,
				overwrite: overwriteMode,
			},
		});

		setShowRestoreDialog(false);
	}, [
		selectedPaths,
		addBasePath,
		repositoryName,
		snapshot.short_id,
		restoreSnapshot,
		deleteExtraFiles,
		excludeXattr,
		restoreLocation,
		customTargetPath,
		overwriteMode,
	]);

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
				<AlertDialogContent className="max-w-lg">
					<AlertDialogHeader>
						<AlertDialogTitle>Confirm Restore</AlertDialogTitle>
						<AlertDialogDescription>
							{selectedPaths.size > 0
								? `This will restore ${selectedPaths.size} selected ${selectedPaths.size === 1 ? "item" : "items"} from the snapshot.`
								: "This will restore everything from the snapshot."}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="space-y-4">
						<div className="space-y-3">
							<Label className="text-sm font-medium">Restore Location</Label>
							<div className="grid grid-cols-2 gap-2">
								<Button
									type="button"
									variant={restoreLocation === "original" ? "secondary" : "outline"}
									size="sm"
									className="flex justify-start gap-2"
									onClick={() => setRestoreLocation("original")}
								>
									<RotateCcw size={16} className="mr-1" />
									Original location
								</Button>
								<Button
									type="button"
									variant={restoreLocation === "custom" ? "secondary" : "outline"}
									size="sm"
									className="justify-start gap-2"
									onClick={() => setRestoreLocation("custom")}
								>
									<FolderOpen size={16} className="mr-1" />
									Custom location
								</Button>
							</div>
							{restoreLocation === "custom" && (
								<div className="space-y-2">
									<Input
										placeholder="/path/to/restore"
										value={customTargetPath}
										onChange={(e) => setCustomTargetPath(e.target.value)}
									/>
									<p className="text-xs text-muted-foreground">Files will be restored directly to this path</p>
								</div>
							)}
						</div>

						<div className="space-y-2">
							<Label className="text-sm font-medium">Overwrite Mode</Label>
							<Select value={overwriteMode} onValueChange={(value) => setOverwriteMode(value as OverwriteMode)}>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="Select overwrite behavior" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={OVERWRITE_MODES.always}>Always overwrite</SelectItem>
									<SelectItem value={OVERWRITE_MODES.ifChanged}>Only if content changed</SelectItem>
									<SelectItem value={OVERWRITE_MODES.ifNewer}>Only if snapshot is newer</SelectItem>
									<SelectItem value={OVERWRITE_MODES.never}>Never overwrite</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								{overwriteMode === OVERWRITE_MODES.always &&
									"Existing files will always be replaced with the snapshot version."}
								{overwriteMode === OVERWRITE_MODES.ifChanged &&
									"Files are only replaced if their content differs from the snapshot."}
								{overwriteMode === OVERWRITE_MODES.ifNewer &&
									"Files are only replaced if the snapshot version has a newer modification time."}
								{overwriteMode === OVERWRITE_MODES.never &&
									"Existing files will never be replaced, only missing files are restored."}
							</p>
						</div>

						<div>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => setShowAdvanced(!showAdvanced)}
								className="h-auto p-0 text-sm font-normal"
							>
								Advanced Options
								<ChevronDown size={16} className={`ml-1 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
							</Button>

							{showAdvanced && (
								<div className="mt-4 space-y-3">
									<div className="space-y-2">
										<Label htmlFor="exclude-xattr" className="text-sm">
											Exclude Extended Attributes
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
									</div>
									<div className="flex items-center space-x-2">
										<Checkbox
											id="delete-extra"
											checked={deleteExtraFiles}
											onCheckedChange={(checked) => setDeleteExtraFiles(checked === true)}
										/>
										<Label htmlFor="delete-extra" className="text-sm font-normal cursor-pointer">
											Delete files not present in the snapshot
										</Label>
									</div>
								</div>
							)}
						</div>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleConfirmRestore}
							disabled={restoreLocation === "custom" && !customTargetPath.trim()}
						>
							Confirm Restore
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
};
