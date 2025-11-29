import { useCallback, useState } from "react";
import { ChevronDown, FolderOpen, RotateCcw } from "lucide-react";
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
	AlertDialogTrigger,
} from "~/client/components/ui/alert-dialog";
import { PathSelector } from "~/client/components/path-selector";
import { OVERWRITE_MODES, type OverwriteMode } from "~/schemas/restic";

type RestoreLocation = "original" | "custom";

export interface RestoreSnapshotOptions {
	include?: string[];
	delete?: boolean;
	excludeXattr?: string[];
	targetPath?: string;
	overwrite?: OverwriteMode;
}

interface Props {
	/** Number of selected items to restore (0 means restore everything) */
	selectedCount?: number;
	/** Callback when restore is confirmed */
	onConfirm: (options: RestoreSnapshotOptions) => void;
	/** Trigger element for the dialog */
	trigger: React.ReactNode;
	/** Pre-selected paths to include in restore (already transformed) */
	includePaths?: string[];
}

export const RestoreSnapshotDialog = (props: Props) => {
	const { selectedCount = 0, onConfirm, trigger, includePaths } = props;

	const [open, setOpen] = useState(false);
	const [deleteExtraFiles, setDeleteExtraFiles] = useState(false);
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [excludeXattr, setExcludeXattr] = useState("");
	const [restoreLocation, setRestoreLocation] = useState<RestoreLocation>("original");
	const [customTargetPath, setCustomTargetPath] = useState("");
	const [overwriteMode, setOverwriteMode] = useState<OverwriteMode>("always");

	const handleConfirmRestore = useCallback(() => {
		const excludeXattrArray = excludeXattr
			?.split(",")
			.map((s) => s.trim())
			.filter(Boolean);

		const isCustomLocation = restoreLocation === "custom";
		const targetPath = isCustomLocation && customTargetPath.trim() ? customTargetPath.trim() : undefined;

		onConfirm({
			include: includePaths && includePaths.length > 0 ? includePaths : undefined,
			delete: deleteExtraFiles,
			excludeXattr: excludeXattrArray && excludeXattrArray.length > 0 ? excludeXattrArray : undefined,
			targetPath,
			overwrite: overwriteMode,
		});

		setOpen(false);
	}, [excludeXattr, restoreLocation, customTargetPath, includePaths, deleteExtraFiles, overwriteMode, onConfirm]);

	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
			<AlertDialogContent className="max-w-lg">
				<AlertDialogHeader>
					<AlertDialogTitle>Confirm Restore</AlertDialogTitle>
					<AlertDialogDescription>
						{selectedCount > 0
							? `This will restore ${selectedCount} selected ${selectedCount === 1 ? "item" : "items"} from the snapshot.`
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
								<PathSelector value={customTargetPath || "/"} onChange={setCustomTargetPath} />
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
	);
};
