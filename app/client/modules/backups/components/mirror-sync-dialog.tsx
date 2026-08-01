import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { syncMirrorMutation, getMirrorSyncStatusOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { ByteSize } from "~/client/components/bytes-size";
import { Button } from "~/client/components/ui/button";
import { Checkbox } from "~/client/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/client/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/client/components/ui/table";
import { useTimeFormat } from "~/client/lib/datetime";
import { parseError } from "~/client/lib/errors";
import type { Repository } from "~/client/lib/types";

type Props = {
	scheduleShortId: string;
	mirror: Repository | null;
	onClose: () => void;
};

export const MirrorSyncDialog = ({ scheduleShortId, mirror, onClose }: Props) => {
	const { formatDateTime } = useTimeFormat();
	const [selectedSnapshotIds, setSelectedSnapshotIds] = useState<Set<string>>(new Set());
	const mirrorShortId = mirror?.shortId ?? "";
	const queryEnabled = mirror !== null;
	const dialogOpen = mirror !== null;

	useEffect(() => {
		setSelectedSnapshotIds(new Set());
	}, [mirrorShortId]);

	const { data: syncStatus, isLoading: isSyncStatusLoading } = useQuery({
		...getMirrorSyncStatusOptions({
			path: { shortId: scheduleShortId, mirrorShortId },
		}),
		enabled: queryEnabled,
	});

	const triggerSync = useMutation({
		...syncMirrorMutation(),
		onSuccess: () => {
			toast.success("Mirror sync started");
			onClose();
		},
		onError: (error) => {
			toast.error("Failed to start sync", {
				description: parseError(error)?.message,
			});
		},
	});

	const toggleSnapshotSelection = (shortId: string) => {
		setSelectedSnapshotIds((previousIds) => {
			const nextIds = new Set(previousIds);
			if (nextIds.has(shortId)) {
				nextIds.delete(shortId);
			} else {
				nextIds.add(shortId);
			}
			return nextIds;
		});
	};

	const toggleAllSnapshots = () => {
		if (!syncStatus) return;

		const allSnapshotsSelected = selectedSnapshotIds.size === syncStatus.missingSnapshots.length;
		if (allSnapshotsSelected) {
			setSelectedSnapshotIds(new Set());
			return;
		}

		const missingSnapshotIds = syncStatus.missingSnapshots.map((snapshot) => snapshot.short_id);
		setSelectedSnapshotIds(new Set(missingSnapshotIds));
	};

	const handleSync = () => {
		if (!mirror) return;

		const snapshotIds = Array.from(selectedSnapshotIds);
		triggerSync.mutate({
			path: {
				shortId: scheduleShortId,
				mirrorShortId: mirror.shortId,
			},
			body: { snapshotIds },
		});
	};

	const handleOpenChange = (open: boolean) => {
		if (!open) {
			onClose();
		}
	};

	const allSnapshotsSelected =
		syncStatus !== undefined &&
		syncStatus.missingSnapshots.length > 0 &&
		selectedSnapshotIds.size === syncStatus.missingSnapshots.length;
	const selectedSnapshotCount = selectedSnapshotIds.size;
	const mirrorName = mirror?.name ?? "mirror repository";

	return (
		<Dialog open={dialogOpen} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Sync snapshots</DialogTitle>
					<DialogDescription>{`Sync missing snapshots to ${mirrorName}.`}</DialogDescription>
				</DialogHeader>

				{isSyncStatusLoading && !syncStatus ? (
					<div className="py-6 text-center text-muted-foreground text-sm">Loading snapshot status...</div>
				) : syncStatus && syncStatus.missingSnapshots.length === 0 ? (
					<div className="py-6 text-center text-muted-foreground text-sm">
						All {syncStatus.sourceCount} snapshots are already synced to this mirror.
					</div>
				) : syncStatus ? (
					<div className="space-y-3">
						<p className="text-sm text-muted-foreground">
							{syncStatus.missingSnapshots.length} of {syncStatus.sourceCount} snapshots are missing in
							this mirror.
						</p>
						<div className="rounded-md border max-h-64 overflow-y-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="w-10">
											<Checkbox
												checked={allSnapshotsSelected}
												onCheckedChange={toggleAllSnapshots}
											/>
										</TableHead>
										<TableHead>ID</TableHead>
										<TableHead>Date</TableHead>
										<TableHead className="text-right">Size</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{syncStatus.missingSnapshots.map((snapshot) => (
										<TableRow
											key={snapshot.short_id}
											className="cursor-pointer"
											onClick={() => toggleSnapshotSelection(snapshot.short_id)}
										>
											<TableCell onClick={(event) => event.stopPropagation()}>
												<Checkbox
													checked={selectedSnapshotIds.has(snapshot.short_id)}
													onCheckedChange={() => toggleSnapshotSelection(snapshot.short_id)}
												/>
											</TableCell>
											<TableCell className="font-mono text-xs">{snapshot.short_id}</TableCell>
											<TableCell className="text-sm">
												{formatDateTime(new Date(snapshot.time))}
											</TableCell>
											<TableCell className="text-right text-sm">
												<ByteSize bytes={snapshot.size} base={1024} />
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					</div>
				) : null}

				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button onClick={handleSync} loading={triggerSync.isPending} disabled={selectedSnapshotCount === 0}>
						Sync {selectedSnapshotCount} snapshots
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
