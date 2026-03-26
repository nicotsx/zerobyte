import { createFileRoute } from "@tanstack/react-router";
import { getBackupSchedule } from "~/client/api-client";
import { getRepositoryOptions, getSnapshotDetailsOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { RestoreSnapshotPage } from "~/client/modules/repositories/routes/restore-snapshot";
import { getVolumeMountPath } from "~/client/lib/volume-path";
import { findCommonAncestor } from "@zerobyte/core/utils";

export const Route = createFileRoute("/(dashboard)/repositories/$repositoryId/$snapshotId/restore")({
	component: RouteComponent,
	errorComponent: (e) => <div>{e.error.message}</div>,
	loader: async ({ params, context }) => {
		const [snapshot, repository] = await Promise.all([
			context.queryClient.ensureQueryData({
				...getSnapshotDetailsOptions({ path: { shortId: params.repositoryId, snapshotId: params.snapshotId } }),
			}),
			context.queryClient.ensureQueryData({ ...getRepositoryOptions({ path: { shortId: params.repositoryId } }) }),
		]);

		let displayBasePath: string | undefined;
		const scheduleShortId = snapshot.tags?.[0];
		if (scheduleShortId) {
			const scheduleRes = await getBackupSchedule({ path: { shortId: scheduleShortId } });
			if (scheduleRes.data) {
				displayBasePath = getVolumeMountPath(scheduleRes.data.volume);
			}
		}

		return { snapshot, repository, queryBasePath: findCommonAncestor(snapshot.paths), displayBasePath };
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
	const { repository, queryBasePath, displayBasePath } = Route.useLoaderData();

	return (
		<RestoreSnapshotPage
			returnPath={`/repositories/${repositoryId}/${snapshotId}`}
			repository={repository}
			snapshotId={snapshotId}
			queryBasePath={queryBasePath}
			displayBasePath={displayBasePath}
		/>
	);
}
