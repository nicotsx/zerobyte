import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, FolderOpen, RotateCcw } from "lucide-react";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import { Input } from "~/client/components/ui/input";
import { Label } from "~/client/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "~/client/components/ui/alert-dialog";
import { PathSelector } from "~/client/components/path-selector";
import { SnapshotTreeBrowser } from "~/client/components/file-browsers/snapshot-tree-browser";
import { RestoreProgress } from "~/client/components/restore-progress";
import { restoreSnapshotMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { type RestoreCompletedEvent, useServerEvents } from "~/client/hooks/use-server-events";
import { OVERWRITE_MODES, type OverwriteMode } from "~/schemas/restic";
import type { Repository, Snapshot } from "~/client/lib/types";
import { handleRepositoryError } from "~/client/lib/errors";
import { useNavigate } from "@tanstack/react-router";
import { findCommonAncestor } from "~/utils/common-ancestor";

type RestoreLocation = "original" | "custom";

interface RestoreFormProps {
	snapshot: Snapshot;
	repository: Repository;
	snapshotId: string;
	returnPath: string;
}

export function RestoreForm({ snapshot, repository, snapshotId, returnPath }: RestoreFormProps) {
	const navigate = useNavigate();
	const { addEventListener } = useServerEvents();

	const volumeBasePath = findCommonAncestor(snapshot.paths);

	const [restoreLocation, setRestoreLocation] = useState<RestoreLocation>("original");
	const [customTargetPath, setCustomTargetPath] = useState("");
	const [overwriteMode, setOverwriteMode] = useState<OverwriteMode>("always");
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [excludeXattr, setExcludeXattr] = useState("");
	const [isRestoreActive, setIsRestoreActive] = useState(false);
	const [restoreResult, setRestoreResult] = useState<RestoreCompletedEvent | null>(null);
	const [showRestoreResultAlert, setShowRestoreResultAlert] = useState(false);
	const restoreCompletedRef = useRef(false);

	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

	useEffect(() => {
		const unsubscribeStarted = addEventListener("restore:started", (startedData) => {
			if (startedData.repositoryId === repository.id && startedData.snapshotId === snapshotId) {
				restoreCompletedRef.current = false;
				setIsRestoreActive(true);
				setRestoreResult(null);
				setShowRestoreResultAlert(false);
			}
		});

		const unsubscribeProgress = addEventListener("restore:progress", (progressData) => {
			if (progressData.repositoryId === repository.id && progressData.snapshotId === snapshotId) {
				if (restoreCompletedRef.current) {
					return;
				}
				setIsRestoreActive(true);
			}
		});

		const unsubscribeCompleted = addEventListener("restore:completed", (completedData) => {
			if (completedData.repositoryId === repository.id && completedData.snapshotId === snapshotId) {
				restoreCompletedRef.current = true;
				setIsRestoreActive(false);
				setRestoreResult(completedData);
				setShowRestoreResultAlert(true);
			}
		});

		return () => {
			unsubscribeStarted();
			unsubscribeProgress();
			unsubscribeCompleted();
		};
	}, [addEventListener, repository.id, snapshotId]);

	const { mutate: restoreSnapshot, isPending: isRestoring } = useMutation({
		...restoreSnapshotMutation(),
		onError: (error) => {
			restoreCompletedRef.current = true;
			setIsRestoreActive(false);
			handleRepositoryError("Restore failed", error, repository.id);
		},
	});

	const handleRestore = useCallback(() => {
		const excludeXattrArray = excludeXattr
			?.split(",")
			.map((s) => s.trim())
			.filter(Boolean);

		const isCustomLocation = restoreLocation === "custom";
		const targetPath = isCustomLocation && customTargetPath.trim() ? customTargetPath.trim() : undefined;

		const includePaths = Array.from(selectedPaths);

		restoreCompletedRef.current = false;
		setIsRestoreActive(true);
		setRestoreResult(null);
		setShowRestoreResultAlert(false);

		restoreSnapshot({
			path: { id: repository.id },
			body: {
				snapshotId,
				include: includePaths.length > 0 ? includePaths : undefined,
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
		overwriteMode,
		restoreSnapshot,
	]);

	const acknowledgeRestoreResult = useCallback(() => {
		setShowRestoreResultAlert(false);
		setRestoreResult(null);
	}, []);

	const handleResultAlertOpenChange = useCallback((open: boolean) => {
		if (open) {
			setShowRestoreResultAlert(true);
		}
	}, []);

	const canRestore = restoreLocation === "original" || customTargetPath.trim();
	const isRestoreRunning = isRestoring || isRestoreActive;

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
					<Button variant="outline" onClick={() => navigate({ to: returnPath })}>
						Cancel
					</Button>
					<Button variant="primary" onClick={handleRestore} disabled={isRestoreRunning || !canRestore}>
						<RotateCcw className="h-4 w-4 mr-2" />
						{isRestoreRunning
							? "Restoring..."
							: selectedPaths.size > 0
								? `Restore ${selectedPaths.size} ${selectedPaths.size === 1 ? "item" : "items"}`
								: "Restore All"}
					</Button>
				</div>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
				<div className="space-y-6">
					{isRestoreRunning && <RestoreProgress repositoryId={repository.id} snapshotId={snapshotId} />}

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
						<SnapshotTreeBrowser
							repositoryId={repository.id}
							snapshotId={snapshotId}
							basePath={volumeBasePath}
							pageSize={500}
							className="flex flex-1 min-h-0 flex-col"
							treeContainerClassName="overflow-auto flex-1 min-h-0 border border-border rounded-md bg-card m-4"
							treeClassName="px-2 py-2"
							loadingMessage="Loading files..."
							emptyMessage="No files in this snapshot"
							withCheckboxes
							selectedPaths={selectedPaths}
							onSelectionChange={setSelectedPaths}
							stateClassName="flex-1 min-h-0"
						/>
					</CardContent>
				</Card>
			</div>

			<AlertDialog open={showRestoreResultAlert} onOpenChange={handleResultAlertOpenChange}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{restoreResult?.status === "success" ? "Restore completed" : "Restore failed"}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{restoreResult?.status === "success"
								? `Snapshot ${snapshotId} was restored successfully.`
								: restoreResult?.error || `Snapshot ${snapshotId} could not be restored.`}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction onClick={acknowledgeRestoreResult}>OK</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
