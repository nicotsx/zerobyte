import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Calendar, Clock, Database, FolderTree, HardDrive, Trash2 } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { ByteSize } from "~/client/components/bytes-size";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/client/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/client/components/ui/tooltip";
import { Button } from "~/client/components/ui/button";
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
import { formatDuration } from "~/utils/utils";
import { deleteSnapshotMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { parseError } from "~/client/lib/errors";
import type { BackupSchedule, Snapshot } from "../lib/types";

type Props = {
	snapshots: Snapshot[];
	backups: BackupSchedule[];
	repositoryId: string;
};

export const SnapshotsTable = ({ snapshots, repositoryId, backups }: Props) => {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [snapshotToDelete, setSnapshotToDelete] = useState<string | null>(null);

	const deleteSnapshot = useMutation({
		...deleteSnapshotMutation(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["listSnapshots"] });
			setShowDeleteConfirm(false);
			setSnapshotToDelete(null);
		},
	});

	const handleDeleteClick = (e: React.MouseEvent, snapshotId: string) => {
		e.stopPropagation();
		setSnapshotToDelete(snapshotId);
		setShowDeleteConfirm(true);
	};

	const handleConfirmDelete = () => {
		if (snapshotToDelete) {
			toast.promise(
				deleteSnapshot.mutateAsync({
					path: { id: repositoryId, snapshotId: snapshotToDelete },
				}),
				{
					loading: "Deleting snapshot...",
					success: "Snapshot deleted successfully",
					error: (error) => parseError(error)?.message || "Failed to delete snapshot",
				},
			);
		}
	};

	const handleRowClick = (snapshotId: string) => {
		navigate(`/repositories/${repositoryId}/${snapshotId}`);
	};

	return (
		<>
			<div className="overflow-x-auto">
				<Table className="border-t">
					<TableHeader className="bg-card-header">
						<TableRow>
							<TableHead className="uppercase">Snapshot ID</TableHead>
							<TableHead className="uppercase">Schedule</TableHead>
							<TableHead className="uppercase">Date & Time</TableHead>
							<TableHead className="uppercase">Size</TableHead>
							<TableHead className="uppercase hidden md:table-cell text-right">Duration</TableHead>
							<TableHead className="uppercase hidden text-right lg:table-cell">Paths</TableHead>
							<TableHead className="uppercase text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{snapshots.map((snapshot) => {
							const backupIds = snapshot.tags.map(Number).filter((tag) => !Number.isNaN(tag));
							const backup = backups.find((b) => backupIds.includes(b.id));

							return (
								<TableRow
									key={snapshot.short_id}
									className="hover:bg-accent/50 cursor-pointer"
									onClick={() => handleRowClick(snapshot.short_id)}
								>
									<TableCell className="font-mono text-sm">
										<div className="flex items-center gap-2">
											<HardDrive className="h-4 w-4 text-muted-foreground" />
											<span className="text-strong-accent">{snapshot.short_id}</span>
										</div>
									</TableCell>
									<TableCell>
										<div className="flex items-center gap-2">
											<Link
												hidden={!backup}
												to={backup ? `/backups/${backup.id}` : "#"}
												onClick={(e) => e.stopPropagation()}
												className="hover:underline"
											>
												<span className="text-sm">{backup ? backup.id : "-"}</span>
											</Link>
											<span hidden={!!backup} className="text-sm text-muted-foreground">
												-
											</span>
										</div>
									</TableCell>
									<TableCell>
										<div className="flex items-center gap-2">
											<Calendar className="h-4 w-4 text-muted-foreground" />
											<span className="text-sm">{new Date(snapshot.time).toLocaleString()}</span>
										</div>
									</TableCell>
									<TableCell>
										<div className="flex items-center gap-2">
											<Database className="h-4 w-4 text-muted-foreground" />
											<span className="font-medium">
												<ByteSize bytes={snapshot.size} base={1024} />
											</span>
										</div>
									</TableCell>
									<TableCell className="hidden md:table-cell">
										<div className="flex items-center justify-end gap-2">
											<Clock className="h-4 w-4 text-muted-foreground" />
											<span className="text-sm text-muted-foreground">{formatDuration(snapshot.duration / 1000)}</span>
										</div>
									</TableCell>
									<TableCell className="hidden lg:table-cell">
										<div className="flex items-center justify-end gap-2">
											<FolderTree className="h-4 w-4 text-muted-foreground" />
											<Tooltip>
												<TooltipTrigger asChild>
													<span className="text-xs bg-primary/10 text-primary rounded-md px-2 py-1 cursor-help">
														{snapshot.paths.length} {snapshot.paths.length === 1 ? "path" : "paths"}
													</span>
												</TooltipTrigger>
												<TooltipContent side="top" className="max-w-md">
													<div className="flex flex-col gap-1">
														{snapshot.paths.map((path) => (
															<div key={`${snapshot.short_id}-${path}`} className="text-xs font-mono">
																{path}
															</div>
														))}
													</div>
												</TooltipContent>
											</Tooltip>
										</div>
									</TableCell>
									<TableCell className="text-right">
										<Button
											variant="ghost"
											size="sm"
											onClick={(e) => handleDeleteClick(e, snapshot.short_id)}
											disabled={deleteSnapshot.isPending}
										>
											<Trash2 className="h-4 w-4 text-destructive" />
										</Button>
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</div>

			<AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete snapshot?</AlertDialogTitle>
						<AlertDialogDescription>
							This action cannot be undone. This will permanently delete the snapshot and all its data from the
							repository.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleConfirmDelete}
							disabled={deleteSnapshot.isPending}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Delete snapshot
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
};
