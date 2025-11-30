import { useQuery } from "@tanstack/react-query";
import { redirect, useParams } from "react-router";
import { listSnapshotFilesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { Card, CardContent, CardHeader, CardTitle } from "~/client/components/ui/card";
import { SnapshotFileBrowser } from "~/client/modules/backups/components/snapshot-file-browser";
import { getSnapshotDetails } from "~/client/api-client";
import type { Route } from "./+types/snapshot-details";

export const handle = {
	breadcrumb: (match: Route.MetaArgs) => [
		{ label: "Repositories", href: "/repositories" },
		{ label: match.params.name, href: `/repositories/${match.params.name}` },
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
	const snapshot = await getSnapshotDetails({
		path: { name: params.name, snapshotId: params.snapshotId },
	});
	if (snapshot.data) return snapshot.data;

	return redirect("/repositories");
};

export default function SnapshotDetailsPage({ loaderData }: Route.ComponentProps) {
	const { name, snapshotId } = useParams<{
		name: string;
		snapshotId: string;
	}>();

	const { data } = useQuery({
		...listSnapshotFilesOptions({
			path: { name: name ?? "", snapshotId: snapshotId ?? "" },
			query: { path: "/" },
		}),
		enabled: !!name && !!snapshotId,
	});

	if (!name || !snapshotId) {
		return (
			<div className="flex items-center justify-center h-full">
				<p className="text-destructive">Invalid snapshot reference</p>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">{name}</h1>
					<p className="text-sm text-muted-foreground">Snapshot: {snapshotId}</p>
				</div>
			</div>

			<SnapshotFileBrowser repositoryName={name} snapshot={loaderData} />

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
								<p>{new Date(data.snapshot.time).toLocaleString()}</p>
							</div>
							<div className="col-span-2">
								<span className="text-muted-foreground">Paths:</span>
								<div className="space-y-1 mt-1">
									{data.snapshot.paths.map((path) => (
										<p key={path} className="font-mono text-xs bg-muted px-2 py-1 rounded break-all">
											{path}
										</p>
									))}
								</div>
							</div>
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
