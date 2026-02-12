import { createFileRoute } from "@tanstack/react-router";
import {
	getRepositoryOptions,
	getSnapshotDetailsOptions,
	listSnapshotFilesOptions,
} from "~/client/api-client/@tanstack/react-query.gen";
import { SnapshotDetailsPage } from "~/client/modules/repositories/routes/snapshot-details";

export const Route = createFileRoute("/(dashboard)/repositories/$repositoryId/$snapshotId/")({
	component: RouteComponent,
	errorComponent: (e) => <div>{e.error.message}</div>,
	loader: async ({ params, context }) => {
		const res = await context.queryClient.ensureQueryData({
			...getRepositoryOptions({ path: { id: params.repositoryId } }),
		})

		void context.queryClient.prefetchQuery({
			...getSnapshotDetailsOptions({
				path: { id: params.repositoryId, snapshotId: params.snapshotId },
			}),
		})
		void context.queryClient.prefetchQuery({
			...listSnapshotFilesOptions({
				path: { id: params.repositoryId, snapshotId: params.snapshotId },
				query: { path: "/" },
			}),
		})

		return res;
	},
	staticData: {
		breadcrumb: (match) => [
			{ label: "Repositories", href: "/repositories" },
			{ label: match.loaderData?.name || "Repository", href: `/repositories/${match.params.repositoryId}` },
			{ label: match.params.snapshotId },
		],
	},
	head: ({ params }) => ({
		meta: [
			{ title: `Zerobyte - ${params.snapshotId}` },
			{
				name: "description",
				content: "Browse and restore files from a backup snapshot.",
			},
		],
	}),
});

function RouteComponent() {
	const { repositoryId, snapshotId } = Route.useParams();

	return <SnapshotDetailsPage repositoryId={repositoryId} snapshotId={snapshotId} />;
}
