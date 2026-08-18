import { createFileRoute } from "@tanstack/react-router";
import { getBackupSchedule } from "~/client/api-client";
import { getRepositoryOptions, getSnapshotDetailsOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { restoreTasksOptions } from "~/client/modules/repositories/restore-tasks";
import { RestoreSnapshotPage } from "~/client/modules/repositories/routes/restore-snapshot";
import { getVolumeMountPath } from "~/client/lib/volume-path";
import { findCommonAncestor } from "@zerobyte/core/utils";

export const Route = createFileRoute("/(dashboard)/repositories/$repositoryId/$snapshotId/restore")({
	component: RouteComponent,
	errorComponent: (e) => <div>{e.error.message}</div>,
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

		let displayBasePath: string | undefined;
		let volumeReadOnly: boolean | undefined;
		const scheduleShortId = snapshot.tags?.[0];
		if (scheduleShortId) {
			const scheduleRes = await getBackupSchedule({ path: { shortId: scheduleShortId } });
			if (scheduleRes.data) {
				displayBasePath = getVolumeMountPath(scheduleRes.data.volume);
				volumeReadOnly = scheduleRes.data.volume.config.readOnly ?? false;
			}
		}

		const hasNonPosixSnapshotPaths = snapshot.paths.some((path) => !path.startsWith("/"));

		return {
			snapshot,
			repository,
			queryBasePath: hasNonPosixSnapshotPaths ? "/" : findCommonAncestor(snapshot.paths),
			displayBasePath,
			hasNonPosixSnapshotPaths,
			volumeReadOnly,
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
	const { repository, queryBasePath, displayBasePath, hasNonPosixSnapshotPaths, volumeReadOnly } =
		Route.useLoaderData();

	return (
		<RestoreSnapshotPage
			returnPath={`/repositories/${repositoryId}/${snapshotId}`}
			repository={repository}
			snapshotId={snapshotId}
			queryBasePath={queryBasePath}
			displayBasePath={displayBasePath}
			hasNonPosixSnapshotPaths={hasNonPosixSnapshotPaths}
			volumeReadOnly={volumeReadOnly}
		/>
	);
}
