import { redirect } from "react-router";
import { getSnapshotDetails } from "~/client/api-client";
import { RestoreForm } from "~/client/components/restore-form";
import type { Route } from "./+types/restore-snapshot";

export const handle = {
	breadcrumb: (match: Route.MetaArgs) => [
		{ label: "Repositories", href: "/repositories" },
		{ label: match.params.name, href: `/repositories/${match.params.name}` },
		{ label: match.params.snapshotId, href: `/repositories/${match.params.name}/${match.params.snapshotId}` },
		{ label: "Restore" },
	],
};

export function meta({ params }: Route.MetaArgs) {
	return [
		{ title: `Zerobyte - Restore Snapshot ${params.snapshotId}` },
		{
			name: "description",
			content: "Restore files from a backup snapshot.",
		},
	];
}

export const clientLoader = async ({ params }: Route.ClientLoaderArgs) => {
	const snapshot = await getSnapshotDetails({
		path: { name: params.name, snapshotId: params.snapshotId },
	});
	if (snapshot.data) return { snapshot: snapshot.data, name: params.name, snapshotId: params.snapshotId };

	return redirect("/repositories");
};

export default function RestoreSnapshotPage({ loaderData }: Route.ComponentProps) {
	const { snapshot, name, snapshotId } = loaderData;

	return (
		<RestoreForm
			snapshot={snapshot}
			repositoryName={name}
			snapshotId={snapshotId}
			returnPath={`/repositories/${name}/${snapshotId}`}
		/>
	);
}
