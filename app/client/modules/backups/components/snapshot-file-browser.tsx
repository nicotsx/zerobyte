import { RotateCcw, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import { Button, buttonVariants } from "~/client/components/ui/button";
import type { Snapshot } from "~/client/lib/types";
import { formatDateTime } from "~/client/lib/datetime";
import { cn } from "~/client/lib/utils";
import { Link } from "@tanstack/react-router";
import { SnapshotTreeBrowser } from "~/client/components/file-browsers/snapshot-tree-browser";
import { getBackupScheduleOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { getVolumeMountPath } from "~/client/lib/volume-path";

interface Props {
	snapshot: Snapshot;
	repositoryId: string;
	backupId?: string;
	basePath?: string;
	onDeleteSnapshot?: (snapshotId: string) => void;
	isDeletingSnapshot?: boolean;
}

const treeProps = {
	pageSize: 500,
	className: "flex flex-1 min-h-0 flex-col",
	treeContainerClassName: "overflow-auto flex-1 min-h-0 border border-border rounded-md bg-card m-4",
	treeClassName: "px-2 py-2",
	emptyMessage: "No files in this snapshot",
	stateClassName: "flex-1 min-h-0",
} as const;

interface ScheduleAwareTreeBrowserProps {
	scheduleShortId: string;
	repositoryId: string;
	snapshotId: string;
}

const ScheduleAwareTreeBrowser = ({ scheduleShortId, repositoryId, snapshotId }: ScheduleAwareTreeBrowserProps) => {
	const { data: schedule, isPending } = useQuery({
		...getBackupScheduleOptions({ path: { shortId: scheduleShortId } }),
		retry: false,
	});

	if (isPending) {
		return <TreeBrowserFallback />;
	}

	return (
		<SnapshotTreeBrowser
			repositoryId={repositoryId}
			snapshotId={snapshotId}
			basePath={schedule ? getVolumeMountPath(schedule.volume) : "/"}
			{...treeProps}
		/>
	);
};

const TreeBrowserFallback = () => (
	<div className={cn(treeProps.treeContainerClassName, "flex items-center justify-center")}>
		<p className="text-muted-foreground">Loading volume info...</p>
	</div>
);

export const SnapshotFileBrowser = (props: Props) => {
	const { snapshot, repositoryId, backupId, basePath, onDeleteSnapshot, isDeletingSnapshot } = props;

	const scheduleShortId = !basePath ? backupId || snapshot.tags?.[0] : undefined;

	return (
		<div className="space-y-4">
			<Card className="h-150 flex flex-col">
				<CardHeader>
					<div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
						<div>
							<CardTitle>File Browser</CardTitle>
							<CardDescription
								className={cn({ hidden: !snapshot.time })}
							>{`Viewing snapshot from ${formatDateTime(snapshot?.time)}`}</CardDescription>
						</div>
						<div className="flex gap-2 flex-wrap sm:flex-nowrap">
							<Link
								to={
									backupId
										? "/backups/$backupId/$snapshotId/restore"
										: "/repositories/$repositoryId/$snapshotId/restore"
								}
								params={
									backupId
										? { backupId, snapshotId: snapshot.short_id }
										: { repositoryId: repositoryId, snapshotId: snapshot.short_id }
								}
								className={buttonVariants({ variant: "primary", size: "sm" })}
							>
								<RotateCcw className="h-4 w-4" />
								Restore
							</Link>
							{onDeleteSnapshot && (
								<Button
									variant="destructive"
									size="sm"
									onClick={() => onDeleteSnapshot(snapshot.short_id)}
									disabled={isDeletingSnapshot}
									loading={isDeletingSnapshot}
								>
									<Trash2 className="h-4 w-4 mr-2" />
									{isDeletingSnapshot ? "Deleting..." : "Delete Snapshot"}
								</Button>
							)}
						</div>
					</div>
				</CardHeader>
				<CardContent className="flex-1 overflow-hidden flex flex-col p-0">
					{basePath ? (
						<SnapshotTreeBrowser
							repositoryId={repositoryId}
							snapshotId={snapshot.short_id}
							basePath={basePath}
							{...treeProps}
						/>
					) : scheduleShortId ? (
						<ScheduleAwareTreeBrowser
							scheduleShortId={scheduleShortId}
							repositoryId={repositoryId}
							snapshotId={snapshot.short_id}
						/>
					) : (
						<SnapshotTreeBrowser
							repositoryId={repositoryId}
							snapshotId={snapshot.short_id}
							basePath="/"
							{...treeProps}
						/>
					)}
				</CardContent>
			</Card>
		</div>
	);
};
