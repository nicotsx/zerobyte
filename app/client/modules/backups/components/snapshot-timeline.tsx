import type { ListSnapshotsResponse } from "~/client/api-client";
import { ByteSize } from "~/client/components/bytes-size";
import { Card, CardContent } from "~/client/components/ui/card";
import { formatDateWithMonth, formatShortDate, formatTime } from "~/client/lib/datetime";
import { cn } from "~/client/lib/utils";
import { RetentionCategoryBadges } from "~/client/components/retention-category-badges";

interface Props {
	snapshots: ListSnapshotsResponse;
	snapshotId?: string;
	loading?: boolean;
	error?: string;
	onSnapshotSelect: (snapshotId: string) => void;
}

export const SnapshotTimeline = (props: Props) => {
	const { snapshots, snapshotId, loading, onSnapshotSelect, error } = props;

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
				<div className="relative flex items-center">
					<div className="flex-1 overflow-hidden">
						<div className="flex gap-4 overflow-x-auto pb-2 *:first:ml-2 *:last:mr-2">
							{snapshots.map((snapshot) => {
								const date = new Date(snapshot.time);
								const isSelected = snapshotId === snapshot.short_id;

								return (
									<button
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
					<span>
						{formatDateWithMonth(snapshots[0].time)}&nbsp;-&nbsp;{formatDateWithMonth(snapshots.at(-1)?.time)}
					</span>
				</div>
			</div>
		</Card>
	);
};
