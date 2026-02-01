import { useQuery } from "@tanstack/react-query";
import { redirect, useParams, Link, Await } from "react-router";
import { listBackupSchedulesOptions, listSnapshotFilesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/client/components/ui/card";
import { SnapshotFileBrowser } from "~/client/modules/backups/components/snapshot-file-browser";
import { formatDateTime } from "~/client/lib/datetime";
import { parseError } from "~/client/lib/errors";
import { getRepository, getSnapshotDetails } from "~/client/api-client";
import type { Route } from "./+types/snapshot-details";
import { Suspense, useState } from "react";
import { Database } from "lucide-react";

export const handle = {
	breadcrumb: (match: Route.MetaArgs) => [
		{ label: "Repositories", href: "/repositories" },
		{ label: match.loaderData?.repository.name || match.params.id, href: `/repositories/${match.params.id}` },
		{ label: match.params.snapshotId },
	],
};

export function meta({ params }: Route.MetaArgs) {
	return [
		{ title: `Zerobyte - Snapshot ${params.snapshotId}` },
		{
			name: "description",
			content: "Browse and restore files from a backup snapshot.",
		},
	];
}

export const clientLoader = async ({ params }: Route.ClientLoaderArgs) => {
	const [snapshot, repository] = await Promise.all([
		getSnapshotDetails({
			path: { id: params.id, snapshotId: params.snapshotId },
		}),
		getRepository({ path: { id: params.id } }),
	]);

	if (!repository.data) return redirect("/repositories");

	return {
		snapshot: snapshot,
		repository: repository.data,
		snapshotError: parseError(snapshot.error)?.message ?? null,
	};
};

export default function SnapshotDetailsPage({ loaderData }: Route.ComponentProps) {
	const { id, snapshotId } = useParams<{
		id: string;
		snapshotId: string;
	}>();

	const [showAllPaths, setShowAllPaths] = useState(false);

	const { data } = useQuery({
		...listSnapshotFilesOptions({
			path: { id: id ?? "", snapshotId: snapshotId ?? "" },
			query: { path: "/" },
		}),
		enabled: !!id && !!snapshotId && !loaderData.snapshotError,
	});

	const schedules = useQuery({
		...listBackupSchedulesOptions(),
	});

	if (!id || !snapshotId) {
		return (
			<div className="flex items-center justify-center h-full">
				<p className="text-destructive">Invalid snapshot reference</p>
			</div>
		);
	}

	if (loaderData.snapshotError) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center justify-center text-center py-12">
					<Database className="mb-4 h-12 w-12 text-destructive" />
					<p className="text-destructive font-semibold">Snapshot not found</p>
					<p className="text-sm text-muted-foreground mt-2">
						This snapshot does not exist in {loaderData.repository.name}.
					</p>
					<p className="text-sm text-muted-foreground mt-1">It may have been deleted manually outside of Zerobyte.</p>
					<div className="mt-4">
						<Link to={`/repositories/${id}?tab=snapshots`}>
							<Button variant="outline">Back to repository</Button>
						</Link>
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">{loaderData.repository.name}</h1>
					<p className="text-sm text-muted-foreground">Snapshot: {snapshotId}</p>
				</div>
			</div>

			<Suspense
				fallback={
					<SnapshotFileBrowser
						repositoryId={id}
						snapshot={{ duration: 0, paths: [], short_id: "", size: 0, tags: [], time: 0 }}
					/>
				}
			>
				<Await resolve={loaderData.snapshot}>
					{(value) => {
						if (!value.data) return <div className="text-destructive">Snapshot data not found.</div>;

						return <SnapshotFileBrowser repositoryId={id} snapshot={value.data} />;
					}}
				</Await>
			</Suspense>

			{data?.snapshot && (
				<Card>
					<CardHeader>
						<CardTitle>Snapshot Information</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2 text-sm">
						<div className="grid grid-cols-2 gap-4">
							<div>
								<span className="text-muted-foreground">Snapshot ID:</span>
								<p className="font-mono break-all">{data.snapshot.id}</p>
							</div>
							<div>
								<span className="text-muted-foreground">Short ID:</span>
								<p className="font-mono break-all">{data.snapshot.short_id}</p>
							</div>
							<div>
								<span className="text-muted-foreground">Hostname:</span>
								<p>{data.snapshot.hostname}</p>
							</div>
							<div>
								<span className="text-muted-foreground">Time:</span>
								<p>{formatDateTime(data.snapshot.time)}</p>
							</div>
							<Suspense fallback={<div>Loading...</div>}>
								<Await resolve={loaderData.snapshot}>
									{(value) => {
										if (!value.data) return null;

										const backupSchedule = schedules.data?.find((s) => value.data.tags.includes(s.shortId));

										return (
											<>
												<div>
													<span className="text-muted-foreground">Backup Schedule:</span>
													<p>
														<Link to={`/backups/${backupSchedule?.id}`} className="text-primary hover:underline">
															{backupSchedule?.name}
														</Link>
													</p>
												</div>
												<div>
													<span className="text-muted-foreground">Volume:</span>
													<p>
														<Link
															to={`/volumes/${backupSchedule?.volume.shortId}`}
															className="text-primary hover:underline"
														>
															{backupSchedule?.volume.name}
														</Link>
													</p>
												</div>
											</>
										);
									}}
								</Await>
							</Suspense>

							<div className="col-span-2">
								<span className="text-muted-foreground">Paths:</span>
								<div className="space-y-1 mt-1">
									{data.snapshot.paths.slice(0, showAllPaths ? undefined : 20).map((path) => (
										<p key={path} className="font-mono text-xs bg-muted px-2 py-1 rounded break-all">
											{path}
										</p>
									))}
									{data.snapshot.paths.length > 20 && (
										<button
											type="button"
											onClick={() => setShowAllPaths(!showAllPaths)}
											className="text-xs text-primary hover:underline mt-1"
										>
											{showAllPaths ? "Show less" : `+ ${data.snapshot.paths.length - 20} more`}
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
