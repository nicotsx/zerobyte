import { createFileRoute } from "@tanstack/react-router";
import { RouteError } from "~/client/components/route-error";
import { getBackupSchedule } from "~/client/api-client";
import { getRepositoryOptions, getSnapshotDetailsOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { restoreTasksOptions } from "~/client/modules/repositories/restore-tasks";
import { RestoreSnapshotPage } from "~/client/modules/repositories/routes/restore-snapshot";
import { getRestoreContext } from "~/client/lib/restore-context";

export const Route = createFileRoute("/(dashboard)/repositories/$repositoryId/$snapshotId/restore")({
	component: RouteComponent,
	errorComponent: RouteError,
	loader: async ({ params, context }) => {
		const activeRestoreTasksOptions = restoreTasksOptions(params.repositoryId, params.snapshotId);
		const [snapshot, repository] = await Promise.all([
			context.queryClient.ensureQueryData({
				...getSnapshotDetailsOptions({
					path: { shortId: params.repositoryId, snapshotId: params.snapshotId },
				}),
			}),
			context.queryClient.ensureQueryData({
				...getRepositoryOptions({ path: { shortId: params.repositoryId } }),
			}),
			context.queryClient.ensureQueryData(activeRestoreTasksOptions),
		]);

		const scheduleShortId = snapshot.tags?.[0];
		let scheduleRes;
		if (scheduleShortId) {
			scheduleRes = await getBackupSchedule({ path: { shortId: scheduleShortId } });
		}

		return {
			snapshot,
			repository,
			...getRestoreContext(snapshot, scheduleRes?.data?.volume),
		};
	},
	staticData: {
		breadcrumb: (match) => [
			{ label: "Repositories", href: "/repositories" },
			{
				label: match.loaderData?.repository?.name || "Repository",
				href: `/repositories/${match.params.repositoryId}`,
			},
			{
				label: match.params.snapshotId,
				href: `/repositories/${match.params.repositoryId}/${match.params.snapshotId}`,
			},
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
	const { snapshot, repository, queryBasePath, displayBasePath, originalLocationUnavailableReason } =
		Route.useLoaderData();

	return (
		<RestoreSnapshotPage
			returnPath={`/repositories/${repositoryId}/${snapshotId}`}
			repository={repository}
			queryBasePath={queryBasePath}
			displayBasePath={displayBasePath}
			originalLocationUnavailableReason={originalLocationUnavailableReason}
			snapshot={snapshot}
		/>
	);
}
