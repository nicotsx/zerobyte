import { ArrowRightLeft } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { ListSnapshotsResponse } from "~/client/api-client";
import { ByteSize } from "~/client/components/bytes-size";
import { Card, CardContent } from "~/client/components/ui/card";
import { Button } from "~/client/components/ui/button";
import { useTimeFormat } from "~/client/lib/datetime";
import { cn } from "~/client/lib/utils";
import { RetentionCategoryBadges } from "~/client/components/retention-category-badges";

export type SnapshotTimelineSortOrder = "asc" | "desc";

export const SNAPSHOT_TIMELINE_SORT_ORDER_COOKIE_NAME = "snapshot_timeline_sort_order";
const SNAPSHOT_TIMELINE_SORT_ORDER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const getSortedSnapshots = (snapshots: ListSnapshotsResponse, sortOrder: SnapshotTimelineSortOrder) => {
	return [...snapshots].sort((snapshotA, snapshotB) => {
		return sortOrder === "desc" ? snapshotB.time - snapshotA.time : snapshotA.time - snapshotB.time;
	});
};

const getSnapshotRange = (snapshots: ListSnapshotsResponse) => {
	if (snapshots.length === 0) {
		return null;
	}

	return snapshots.reduce(
		(range, snapshot) => ({
			oldest: snapshot.time < range.oldest.time ? snapshot : range.oldest,
			newest: snapshot.time > range.newest.time ? snapshot : range.newest,
		}),
		{ oldest: snapshots[0], newest: snapshots[0] },
	);
};

interface Props {
	snapshots: ListSnapshotsResponse;
	snapshotId?: string;
	loading?: boolean;
	error?: string;
	initialSortOrder?: SnapshotTimelineSortOrder;
	onSnapshotSelect: (snapshotId: string) => void;
}

export const SnapshotTimeline = (props: Props) => {
	const { snapshots, snapshotId, loading, onSnapshotSelect, error, initialSortOrder = "asc" } = props;
	const selectedRef = useRef<HTMLButtonElement>(null);
	const { formatDateWithMonth, formatShortDate, formatTime } = useTimeFormat();
	const [sortOrder, setSortOrder] = useState<SnapshotTimelineSortOrder>(initialSortOrder);
	const sortedSnapshots = useMemo(() => getSortedSnapshots(snapshots, sortOrder), [snapshots, sortOrder]);
	const snapshotRange = useMemo(() => getSnapshotRange(snapshots), [snapshots]);

	const sortOrderButtonLabel = "Toggle snapshot sort order";

	const handleToggleSortOrder = () => {
		setSortOrder((currentSortOrder) => {
			const nextSortOrder = currentSortOrder === "asc" ? "desc" : "asc";
			document.cookie = `${SNAPSHOT_TIMELINE_SORT_ORDER_COOKIE_NAME}=${nextSortOrder}; path=/; max-age=${SNAPSHOT_TIMELINE_SORT_ORDER_COOKIE_MAX_AGE}`;
			return nextSortOrder;
		});
	};

	if (error) {
		return (
			<Card>
				<CardContent className="flex items-center justify-center text-center">
					<p className="text-destructive text-sm">{error}</p>
				</CardContent>
			</Card>
		);
	}

	if (loading) {
		return (
			<Card>
				<div className="flex items-center justify-center h-24">
					<p className="text-muted-foreground">Loading snapshots...</p>
				</div>
			</Card>
		);
	}

	if (snapshots.length === 0) {
		return (
			<Card>
				<div className="flex items-center justify-center h-24">
					<p className="text-muted-foreground">No snapshots available</p>
				</div>
			</Card>
		);
	}

	return (
		<Card className="p-0 pt-2">
			<div className="w-full bg-card">
				<div className="items-center flex flex-col gap-3 border-b border-border px-4 pb-2 sm:flex-row sm:items-center sm:justify-between">
					<span className="text-sm font-medium">Snapshots</span>
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							size="icon"
							variant="ghost"
							aria-label={sortOrderButtonLabel}
							aria-pressed={sortOrder === "desc"}
							title={sortOrderButtonLabel}
							onClick={handleToggleSortOrder}
						>
							<ArrowRightLeft className="h-4 w-4" />
						</Button>
					</div>
				</div>
				<div className="relative flex items-center">
					<div className="flex-1 overflow-hidden pt-2">
						<div className="snapshot-scrollable flex gap-4 overflow-x-auto pb-2 *:first:ml-2 *:last:mr-2">
							{sortedSnapshots.map((snapshot) => {
								const date = new Date(snapshot.time);
								const isSelected = snapshotId === snapshot.short_id;

								return (
									<button
										ref={isSelected ? selectedRef : undefined}
										type="button"
										key={snapshot.short_id}
										onClick={() => onSnapshotSelect(snapshot.short_id)}
										className={cn(
											"shrink-0 flex flex-col items-center gap-2 p-3 rounded-lg transition-all w-25",
											"border-2 cursor-pointer",
											{
												"border-primary bg-primary/10 shadow-md": isSelected,
												"border-border hover:border-accent hover:bg-accent/5": !isSelected,
											},
										)}
									>
										<div className="text-xs font-semibold text-foreground">{formatShortDate(date)}</div>
										<div className="text-xs text-muted-foreground">{formatTime(date)}</div>
										<div className="text-xs text-muted-foreground opacity-75">
											<ByteSize bytes={snapshot.size} base={1024} />
										</div>
										<RetentionCategoryBadges categories={snapshot.retentionCategories} className="mt-1" />
									</button>
								);
							})}
						</div>
					</div>
				</div>

				<div className="px-4 py-2 text-xs text-muted-foreground bg-card-header border-t border-border flex justify-between">
					<span>{snapshots.length} snapshots</span>
					{snapshotRange && (
						<span>
							{formatDateWithMonth(snapshotRange.oldest.time)}&nbsp;-&nbsp;
							{formatDateWithMonth(snapshotRange.newest.time)}
						</span>
					)}
				</div>
			</div>
		</Card>
	);
};
