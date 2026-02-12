import { createFileRoute } from "@tanstack/react-router";
import { getRepositoryOptions, getSnapshotDetailsOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { RestoreSnapshotPage } from "~/client/modules/repositories/routes/restore-snapshot";

export const Route = createFileRoute("/(dashboard)/repositories/$repositoryId/$snapshotId/restore")({
	component: RouteComponent,
	errorComponent: (e) => <div>{e.error.message}</div>,
	loader: async ({ params, context }) => {
		const [snapshot, repository] = await Promise.all([
			context.queryClient.ensureQueryData({
				...getSnapshotDetailsOptions({ path: { id: params.repositoryId, snapshotId: params.snapshotId } }),
			}),
			context.queryClient.ensureQueryData({ ...getRepositoryOptions({ path: { id: params.repositoryId } }) }),
		])

		return { snapshot, repository };
	},
	staticData: {
		breadcrumb: (match) => [
			{ label: "Repositories", href: "/repositories" },
			{ label: match.loaderData?.repository?.name || "Repository", href: `/repositories/${match.params.repositoryId}` },
			{ label: match.params.snapshotId, href: `/repositories/${match.params.repositoryId}/${match.params.snapshotId}` },
			{ label: "Restore" },
		],
	},
	head: ({ params }) => ({
		meta: [
			{ title: `Zerobyte - Restore Snapshot ${params.snapshotId}` },
			{
				name: "description",
				content: "Restore files from a backup snapshot.",
			},
		],
	}),
});

function RouteComponent() {
	const { repositoryId, snapshotId } = Route.useParams();
	const { snapshot, repository } = Route.useLoaderData();

	return (
		<RestoreSnapshotPage
			returnPath={`/repositories/${repositoryId}/${snapshotId}`}
			snapshot={snapshot}
			repository={repository}
			snapshotId={snapshotId}
		/>
	)
}
