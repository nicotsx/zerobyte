import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileIcon, RotateCcw, Trash2 } from "lucide-react";
import { FileTree } from "~/client/components/file-tree";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import { Button, buttonVariants } from "~/client/components/ui/button";
import type { Snapshot } from "~/client/lib/types";
import { listSnapshotFilesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { formatDateTime } from "~/client/lib/datetime";
import { useFileBrowser } from "~/client/hooks/use-file-browser";
import { cn } from "~/client/lib/utils";
import { Link } from "@tanstack/react-router";

interface Props {
	snapshot: Snapshot;
	repositoryId: string;
	backupId?: string;
	onDeleteSnapshot?: (snapshotId: string) => void;
	isDeletingSnapshot?: boolean;
}

export const SnapshotFileBrowser = (props: Props) => {
	const { snapshot, repositoryId, backupId, onDeleteSnapshot, isDeletingSnapshot } = props;

	const queryClient = useQueryClient();

	const volumeBasePath = snapshot.paths[0]?.match(/^(.*?_data)(\/|$)/)?.[1] || "/";

	const { data: filesData, isLoading: filesLoading } = useQuery({
		...listSnapshotFilesOptions({
			path: { id: repositoryId, snapshotId: snapshot.short_id },
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
					path: { id: repositoryId, snapshotId: snapshot.short_id },
					query: { path, offset: offset.toString(), limit: "500" },
				}),
			);
		},
		prefetchFolder: (path) => {
			void queryClient.prefetchQuery(
				listSnapshotFilesOptions({
					path: { id: repositoryId, snapshotId: snapshot.short_id },
					query: { path, offset: "0", limit: "500" },
				}),
			);
		},
		pathTransform: {
			strip: stripBasePath,
			add: addBasePath,
		},
	});

	return (
		<div className="space-y-4">
			<Card className="h-150 flex flex-col">
				<CardHeader>
					<div className="flex items-start justify-between">
						<div>
							<CardTitle>File Browser</CardTitle>
							<CardDescription
								className={cn({ hidden: !snapshot.time })}
							>{`Viewing snapshot from ${formatDateTime(snapshot?.time)}`}</CardDescription>
						</div>
						<div className="flex gap-2">
							<Link
								to={backupId ? "/backups/$backupId/$snapshotId/restore" : "/repositories/$repoId/$snapId/restore"}
								params={
									backupId
										? { backupId, snapshotId: snapshot.short_id }
										: { repoId: repositoryId, snapId: snapshot.short_id }
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
							/>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
};
