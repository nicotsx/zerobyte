import { createFileRoute } from "@tanstack/react-router";
import {
	getRepositoryOptions,
	getSnapshotDetailsOptions,
	listBackupSchedulesOptions,
} from "~/client/api-client/@tanstack/react-query.gen";
import { SnapshotDetailsPage } from "~/client/modules/repositories/routes/snapshot-details";
import { prefetchOrSkip } from "~/utils/prefetch";

export const Route = createFileRoute("/(dashboard)/repositories/$repositoryId/$snapshotId/")({
	component: RouteComponent,
	errorComponent: (e) => <div>{e.error.message}</div>,
	loader: async ({ params, context }) => {
		const [res] = await Promise.all([
			context.queryClient.ensureQueryData({ ...getRepositoryOptions({ path: { shortId: params.repositoryId } }) }),
			context.queryClient.ensureQueryData({ ...listBackupSchedulesOptions() }),
		]);

		const snapshotOptions = getSnapshotDetailsOptions({
			path: { shortId: params.repositoryId, snapshotId: params.snapshotId },
		});
		await prefetchOrSkip(context.queryClient, snapshotOptions);

		return {
			...res,
			snapshot: context.queryClient.getQueryData(snapshotOptions.queryKey),
		};
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
	const { snapshot } = Route.useLoaderData();

	return <SnapshotDetailsPage repositoryId={repositoryId} snapshotId={snapshotId} initialSnapshot={snapshot} />;
}
