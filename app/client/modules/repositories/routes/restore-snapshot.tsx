import { redirect } from "react-router";
import { getRepository, getSnapshotDetails } from "~/client/api-client";
import { RestoreForm } from "~/client/components/restore-form";
import type { Route } from "./+types/restore-snapshot";

export const handle = {
	breadcrumb: (match: Route.MetaArgs) => [
		{ label: "Repositories", href: "/repositories" },
		{ label: match.loaderData?.repository.name || match.params.id, href: `/repositories/${match.params.id}` },
		{ label: match.params.snapshotId, href: `/repositories/${match.params.id}/${match.params.snapshotId}` },
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
		path: { id: params.id, snapshotId: params.snapshotId },
	});
	if (!snapshot.data) return redirect("/repositories");

	const repository = await getRepository({ path: { id: params.id } });
	if (!repository.data) return redirect(`/repositories`);

	return { snapshot: snapshot.data, id: params.id, repository: repository.data, snapshotId: params.snapshotId };
};

export default function RestoreSnapshotPage({ loaderData }: Route.ComponentProps) {
	const { snapshot, id, snapshotId, repository } = loaderData;

	return (
		<RestoreForm
			snapshot={snapshot}
			repository={repository}
			snapshotId={snapshotId}
			returnPath={`/repositories/${id}/${snapshotId}`}
		/>
	);
}
