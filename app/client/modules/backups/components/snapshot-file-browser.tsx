import { RotateCcw, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import { Button, buttonVariants } from "~/client/components/ui/button";
import type { Snapshot } from "~/client/lib/types";
import { formatDateTime } from "~/client/lib/datetime";
import { cn } from "~/client/lib/utils";
import { Link } from "@tanstack/react-router";
import { SnapshotTreeBrowser } from "~/client/components/file-browsers/snapshot-tree-browser";
import { findCommonAncestor } from "~/utils/common-ancestor";

interface Props {
	snapshot: Snapshot;
	repositoryId: string;
	backupId?: string;
	onDeleteSnapshot?: (snapshotId: string) => void;
	isDeletingSnapshot?: boolean;
}

export const SnapshotFileBrowser = (props: Props) => {
	const { snapshot, repositoryId, backupId, onDeleteSnapshot, isDeletingSnapshot } = props;

	const volumeBasePath = findCommonAncestor(snapshot.paths);

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
					<SnapshotTreeBrowser
						repositoryId={repositoryId}
						snapshotId={snapshot.short_id}
						basePath={volumeBasePath}
						pageSize={500}
						className="flex flex-1 min-h-0 flex-col"
						treeContainerClassName="overflow-auto flex-1 min-h-0 border border-border rounded-md bg-card m-4"
						treeClassName="px-2 py-2"
						loadingMessage="Loading files..."
						emptyMessage="No files in this snapshot"
						stateClassName="flex-1 min-h-0"
					/>
				</CardContent>
			</Card>
		</div>
	);
};
