import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import {
	getRepositoryOptions,
	getSnapshotDetailsOptions,
	listBackupSchedulesOptions,
} from "~/client/api-client/@tanstack/react-query.gen";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/client/components/ui/card";
import { SnapshotFileBrowser } from "~/client/modules/backups/components/snapshot-file-browser";
import { formatDateTime } from "~/client/lib/datetime";
import { useState } from "react";
import { Database } from "lucide-react";
import { Link, useParams } from "@tanstack/react-router";

// export const handle = {
// 	breadcrumb: (match: Route.MetaArgs) => [
// 		{ label: "Repositories", href: "/repositories" },
// 		{ label: match.loaderData?.repository.name || match.params.id, href: `/repositories/${match.params.id}` },
// 		{ label: match.params.snapshotId },
// 	],
// };

export const SnapshotError = () => {
	const { repoId } = useParams({ from: "/(dashboard)/repositories/$repoId/$snapshotId" });

	return (
		<Card>
			<CardContent className="flex flex-col items-center justify-center text-center py-12">
				<Database className="mb-4 h-12 w-12 text-destructive" />
				<p className="text-destructive font-semibold">Snapshot not found</p>
				<p className="text-sm text-muted-foreground mt-2">This snapshot does not exist in this repository</p>
				<p className="text-sm text-muted-foreground mt-1">It may have been deleted manually outside of Zerobyte.</p>
				<div className="mt-4">
					<Link
						to={`/repositories/$repositoryId`}
						search={() => ({ tab: "snapshots" })}
						params={{ repositoryId: repoId }}
					>
						<Button variant="outline">Back to repository</Button>
					</Link>
				</div>
			</CardContent>
		</Card>
	);
};

const FilebrowserFallback = ({ repositoryId, snapshotId }: { repositoryId: string; snapshotId: string }) => {
	return (
		<SnapshotFileBrowser
			repositoryId={repositoryId}
			snapshot={{
				duration: 0,
				paths: [],
				short_id: snapshotId,
				size: 0,
				tags: [],
				time: 0,
				hostname: "",
				retentionCategories: [],
			}}
		/>
	);
};

export function SnapshotDetailsPage({ repositoryId, snapshotId }: { repositoryId: string; snapshotId: string }) {
	const [showAllPaths, setShowAllPaths] = useState(false);

	const { data: repository } = useSuspenseQuery({
		...getRepositoryOptions({ path: { id: repositoryId } }),
	});

	const { data: schedules } = useSuspenseQuery({
		...listBackupSchedulesOptions(),
	});

	const { data, error } = useQuery({
		...getSnapshotDetailsOptions({ path: { id: repositoryId, snapshotId: snapshotId } }),
	});
	const backupSchedule = schedules?.find((s) => data?.tags.includes(s.shortId));

	if (error) {
		return (
			<>
				<div className="flex items-center justify-between mb-4">
					<div>
						<h1 className="text-2xl font-bold">{repository.name}</h1>
						<p className="text-sm text-muted-foreground">Snapshot: {snapshotId}</p>
					</div>
				</div>
				<SnapshotError />
			</>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">{repository.name}</h1>
					<p className="text-sm text-muted-foreground">Snapshot: {snapshotId}</p>
				</div>
			</div>

			{data ? (
				<SnapshotFileBrowser repositoryId={repositoryId} snapshot={data} />
			) : (
				<FilebrowserFallback repositoryId={repositoryId} snapshotId={snapshotId} />
			)}

			{data && (
				<Card>
					<CardHeader>
						<CardTitle>Snapshot Information</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2 text-sm">
						<div className="grid grid-cols-2 gap-4">
							<div>
								<span className="text-muted-foreground">Snapshot ID:</span>
								<p className="font-mono break-all">{data.short_id}</p>
							</div>
							<div>
								<span className="text-muted-foreground">Short ID:</span>
								<p className="font-mono break-all">{data.short_id}</p>
							</div>
							<div>
								<span className="text-muted-foreground">Hostname:</span>
								<p>{data.hostname}</p>
							</div>
							<div>
								<span className="text-muted-foreground">Time:</span>
								<p>{formatDateTime(data.time)}</p>
							</div>
							<>
								<div>
									<span className="text-muted-foreground">Backup Schedule:</span>
									<p>
										<Link to={`/backups/$backupScheduleId`} className="text-primary hover:underline">
											{backupSchedule?.name}
										</Link>
									</p>
								</div>
								<div>
									<span className="text-muted-foreground">Volume:</span>
									<p>
										<Link
											to={`/volumes/$volumeId`}
											className="text-primary hover:underline"
											params={{ volumeId: backupSchedule?.volume.shortId || "" }}
										>
											{backupSchedule?.volume.name}
										</Link>
									</p>
								</div>
							</>

							<div className="col-span-2">
								<span className="text-muted-foreground">Paths:</span>
								<div className="space-y-1 mt-1">
									{data.paths.slice(0, showAllPaths ? undefined : 20).map((path) => (
										<p key={path} className="font-mono text-xs bg-muted px-2 py-1 rounded break-all">
											{path}
										</p>
									))}
									{data.paths.length > 20 && (
										<button
											type="button"
											onClick={() => setShowAllPaths(!showAllPaths)}
											className="text-xs text-primary hover:underline mt-1"
										>
											{showAllPaths ? "Show less" : `+ ${data.paths.length - 20} more`}
										</button>
									)}
								</div>
							</div>
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
