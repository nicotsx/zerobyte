import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { syncMirrorMutation } from "~/client/api-client/@tanstack/react-query.gen";
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
import { useMirrorStatus } from "../mirror-tasks";

type Props = {
	scheduleShortId: string;
	mirror: Repository;
	onClose: () => void;
};

export const MirrorSyncDialog = ({ scheduleShortId, mirror, onClose }: Props) => {
	const { formatDateTime } = useTimeFormat();
	const [selectedSnapshotIds, setSelectedSnapshotIds] = useState<Set<string>>(new Set());
	const lookup = useMirrorStatus(scheduleShortId, mirror.shortId);

	const statusResult = lookup.result;
	const lookupPending = lookup.isPending;
	const lookupUnsuccessful = lookup.isError;
	const lookupStatusMessage = "Checking snapshot status...";

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
		if (!statusResult) return;

		const allSnapshotsSelected = selectedSnapshotIds.size === statusResult.missingSnapshots.length;
		if (allSnapshotsSelected) {
			setSelectedSnapshotIds(new Set());
			return;
		}

		const missingSnapshotIds = statusResult.missingSnapshots.map((snapshot) => snapshot.short_id);
		setSelectedSnapshotIds(new Set(missingSnapshotIds));
	};

	const handleSync = () => {
		const snapshotIds = Array.from(selectedSnapshotIds);
		triggerSync.mutate({
			path: {
				shortId: scheduleShortId,
				mirrorShortId: mirror.shortId,
			},
			body: { snapshotIds },
		});
	};

	const handleCancelLookup = () => {
		const cancellation = lookup.cancel();
		if (!cancellation) return;

		void cancellation.catch((error) => {
			toast.error("Failed to cancel snapshot lookup", {
				description: parseError(error)?.message,
			});
		});
	};

	const handleOpenChange = (open: boolean) => {
		if (!open) {
			onClose();
		}
	};

	const allSnapshotsSelected =
		statusResult !== null &&
		statusResult.missingSnapshots.length > 0 &&
		selectedSnapshotIds.size === statusResult.missingSnapshots.length;
	const selectedSnapshotCount = selectedSnapshotIds.size;
	const mirrorName = mirror.name;
	const lookupErrorMessage = lookup.error ?? "Snapshot lookup did not complete.";
	const lookupFailureMessage =
		lookup.status === "cancelled"
			? "Snapshot lookup was cancelled."
			: lookup.status === "stale"
				? "Snapshot lookup became stale."
				: lookupErrorMessage;

	return (
		<Dialog open onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Sync snapshots</DialogTitle>
					<DialogDescription>{`Sync missing snapshots to ${mirrorName}.`}</DialogDescription>
				</DialogHeader>

				{lookupPending ? (
					<div className="flex items-center justify-center gap-2 py-6 text-center text-muted-foreground text-sm">
						<Loader2 className="h-4 w-4 animate-spin" />
						<span>{lookupStatusMessage}</span>
					</div>
				) : lookupUnsuccessful ? (
					<div className="py-6 text-center text-muted-foreground text-sm" role="alert">
						{lookupFailureMessage}
					</div>
				) : statusResult && statusResult.missingSnapshots.length === 0 ? (
					<div className="py-6 text-center text-muted-foreground text-sm">
						All {statusResult.sourceCount} snapshots are already synced to this mirror.
					</div>
				) : statusResult ? (
					<div className="space-y-3">
						<p className="text-sm text-muted-foreground">
							{statusResult.missingSnapshots.length} of {statusResult.sourceCount} snapshots are missing
							in this mirror.
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
									{statusResult.missingSnapshots.map((snapshot) => (
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
						Close
					</Button>
					{lookupUnsuccessful ? <Button onClick={() => lookup.retry()}>Retry</Button> : null}
					{lookup.canCancel ? (
						<Button variant="destructive" onClick={handleCancelLookup} loading={lookup.isCancelling}>
							Cancel lookup
						</Button>
					) : null}
					{statusResult && statusResult.missingSnapshots.length > 0 ? (
						<Button
							onClick={handleSync}
							loading={triggerSync.isPending}
							disabled={selectedSnapshotCount === 0}
						>
							Sync {selectedSnapshotCount} snapshots
						</Button>
					) : null}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
