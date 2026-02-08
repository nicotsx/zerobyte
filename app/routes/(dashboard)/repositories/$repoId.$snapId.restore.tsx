import { createFileRoute } from "@tanstack/react-router";
import { getRepositoryOptions, getSnapshotDetailsOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { RestoreSnapshotPage } from "~/client/modules/repositories/routes/restore-snapshot";

export const Route = createFileRoute("/(dashboard)/repositories/$repoId/$snapId/restore")({
	component: RouteComponent,
	errorComponent: (e) => <div>{e.error.message}</div>,
	loader: async ({ params, context }) => {
		const [snapshot, repository] = await Promise.all([
			context.queryClient.ensureQueryData({
				...getSnapshotDetailsOptions({ path: { id: params.repoId, snapshotId: params.snapId } }),
			}),
			context.queryClient.ensureQueryData({ ...getRepositoryOptions({ path: { id: params.repoId } }) }),
		]);

		return { snapshot, repository };
	},
	staticData: {
		breadcrumb: (match) => [
			{ label: "Repositories", href: "/repositories" },
			{ label: match.loaderData?.repository?.name || "Repository", href: `/repositories/${match.params.repoId}` },
			{ label: match.params.snapId, href: `/repositories/${match.params.repoId}/${match.params.snapId}` },
			{ label: "Restore" },
		],
	},
	head: ({ params }) => ({
		meta: [
			{ title: `Zerobyte - Restore Snapshot ${params.snapId}` },
			{
				name: "description",
				content: "Restore files from a backup snapshot.",
			},
		],
	}),
});

function RouteComponent() {
	const { repoId, snapId } = Route.useParams();
	const { snapshot, repository } = Route.useLoaderData();

	return (
		<RestoreSnapshotPage
			returnPath={`/repositories/${repoId}/${snapId}`}
			snapshot={snapshot}
			repository={repository}
			snapshotId={snapId}
		/>
	);
}
