import { createFileRoute } from "@tanstack/react-router";
import {
	getRepositoryOptions,
	getSnapshotDetailsOptions,
	listSnapshotFilesOptions,
} from "~/client/api-client/@tanstack/react-query.gen";
import { SnapshotDetailsPage } from "~/client/modules/repositories/routes/snapshot-details";

export const Route = createFileRoute("/(dashboard)/repositories/$repoId/$snapshotId")({
	component: RouteComponent,
	errorComponent: (e) => <div>{e.error.message}</div>,
	loader: async ({ params, context }) => {
		await context.queryClient.ensureQueryData({
			...getRepositoryOptions({ path: { id: params.repoId } }),
		});

		context.queryClient.prefetchQuery({
			...getSnapshotDetailsOptions({
				path: { id: params.repoId, snapshotId: params.snapshotId },
			}),
		});
		context.queryClient.prefetchQuery({
			...listSnapshotFilesOptions({
				path: { id: params.repoId, snapshotId: params.snapshotId },
				query: { path: "/" },
			}),
		});
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
	const { repoId, snapshotId } = Route.useParams();

	return <SnapshotDetailsPage repositoryId={repoId} snapshotId={snapshotId} />;
}
