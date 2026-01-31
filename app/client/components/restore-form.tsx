import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { ChevronDown, FileIcon, FolderOpen, RotateCcw } from "lucide-react";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import { Checkbox } from "~/client/components/ui/checkbox";
import { Input } from "~/client/components/ui/input";
import { Label } from "~/client/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { PathSelector } from "~/client/components/path-selector";
import { FileTree } from "~/client/components/file-tree";
import { listSnapshotFilesOptions, restoreSnapshotMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { useFileBrowser } from "~/client/hooks/use-file-browser";
import { OVERWRITE_MODES, type OverwriteMode } from "~/schemas/restic";
import type { Repository, Snapshot } from "~/client/lib/types";

type RestoreLocation = "original" | "custom";

interface RestoreFormProps {
	snapshot: Snapshot;
	repository: Repository;
	snapshotId: string;
	returnPath: string;
}

export function RestoreForm({ snapshot, repository, snapshotId, returnPath }: RestoreFormProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const volumeBasePath = snapshot.paths[0]?.match(/^(.*?_data)(\/|$)/)?.[1] || "/";

	const [restoreLocation, setRestoreLocation] = useState<RestoreLocation>("original");
	const [customTargetPath, setCustomTargetPath] = useState("");
	const [overwriteMode, setOverwriteMode] = useState<OverwriteMode>("always");
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [excludeXattr, setExcludeXattr] = useState("");
	const [deleteExtraFiles, setDeleteExtraFiles] = useState(false);

	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

	const { data: filesData, isLoading: filesLoading } = useQuery({
		...listSnapshotFilesOptions({
			path: { id: repository.id, snapshotId },
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
		fetchFolder: async (path, offset = 0) => {
			return await queryClient.ensureQueryData(
				listSnapshotFilesOptions({
					path: { id: repository.id, snapshotId },
					query: { path, offset, limit: 500 },
				}),
			);
		},
		prefetchFolder: (path) => {
			void queryClient.prefetchQuery(
				listSnapshotFilesOptions({
					path: { id: repository.id, snapshotId },
					query: { path, offset: 0, limit: 500 },
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
		onSuccess: () => {
			toast.success("Restore completed");
			void navigate(returnPath);
		},
		onError: (error) => {
			toast.error("Restore failed", { description: error.message || "Failed to restore snapshot" });
		},
	});

	const handleRestore = useCallback(() => {
		const excludeXattrArray = excludeXattr
			?.split(",")
			.map((s) => s.trim())
			.filter(Boolean);

		const isCustomLocation = restoreLocation === "custom";
		const targetPath = isCustomLocation && customTargetPath.trim() ? customTargetPath.trim() : undefined;

		const pathsArray = Array.from(selectedPaths);
		const includePaths = pathsArray.map((path) => addBasePath(path));

		restoreSnapshot({
			path: { id: repository.id },
			body: {
				snapshotId,
				include: includePaths.length > 0 ? includePaths : undefined,
				delete: deleteExtraFiles,
				excludeXattr: excludeXattrArray && excludeXattrArray.length > 0 ? excludeXattrArray : undefined,
				targetPath,
				overwrite: overwriteMode,
			},
		});
	}, [
		repository.id,
		snapshotId,
		excludeXattr,
		restoreLocation,
		customTargetPath,
		selectedPaths,
		addBasePath,
		deleteExtraFiles,
		overwriteMode,
		restoreSnapshot,
	]);

	const canRestore = restoreLocation === "original" || customTargetPath.trim();

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">Restore Snapshot</h1>
					<p className="text-sm text-muted-foreground">
						{repository.name} / {snapshotId}
					</p>
				</div>
				<div className="flex gap-2">
					<Button variant="outline" onClick={() => navigate(returnPath)}>
						Cancel
					</Button>
					<Button variant="primary" onClick={handleRestore} disabled={isRestoring || !canRestore}>
						<RotateCcw className="h-4 w-4 mr-2" />
						{isRestoring
							? "Restoring..."
							: selectedPaths.size > 0
								? `Restore ${selectedPaths.size} ${selectedPaths.size === 1 ? "item" : "items"}`
								: "Restore All"}
					</Button>
				</div>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
				<div className="space-y-6">
					<Card>
						<CardHeader>
							<CardTitle>Restore Location</CardTitle>
							<CardDescription>Choose where to restore the files</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="grid grid-cols-1 gap-2">
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
									<PathSelector value={customTargetPath || "/"} onChange={setCustomTargetPath} />
									<p className="text-xs text-muted-foreground">Files will be restored directly to this path</p>
								</div>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Overwrite Mode</CardTitle>
							<CardDescription>How to handle existing files</CardDescription>
						</CardHeader>
						<CardContent className="space-y-3">
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
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="cursor-pointer" onClick={() => setShowAdvanced(!showAdvanced)}>
							<div className="flex items-center justify-between">
								<CardTitle className="text-base">Advanced options</CardTitle>
								<ChevronDown size={16} className={`transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
							</div>
						</CardHeader>
						{showAdvanced && (
							<CardContent className="space-y-4">
								<div className="space-y-2">
									<Label htmlFor="exclude-xattr" className="text-sm">
										Exclude extended attributes
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
							</CardContent>
						)}
					</Card>
				</div>
				<Card className="lg:col-span-2 flex flex-col">
					<CardHeader>
						<CardTitle>Select Files to Restore</CardTitle>
						<CardDescription>
							{selectedPaths.size > 0
								? `${selectedPaths.size} ${selectedPaths.size === 1 ? "item" : "items"} selected`
								: "Select specific files or folders, or leave empty to restore everything"}
						</CardDescription>
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
									onLoadMore={fileBrowser.handleLoadMore}
									getFolderPagination={fileBrowser.getFolderPagination}
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
		</div>
	);
}
