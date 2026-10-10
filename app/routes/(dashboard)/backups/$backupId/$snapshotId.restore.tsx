import { createFileRoute } from "@tanstack/react-router";
import { getBackupSchedule } from "~/client/api-client";
import { getRepositoryOptions, getSnapshotDetailsOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { restoreTasksOptions } from "~/client/modules/repositories/restore-tasks";
import { RestoreSnapshotPage } from "~/client/modules/repositories/routes/restore-snapshot";
import { getVolumeMountPath } from "~/client/lib/volume-path";
import { findCommonAncestor } from "@zerobyte/core/utils";
import { getBackupSource } from "~/client/modules/backups/lib/backup-context";

export const Route = createFileRoute("/(dashboard)/backups/$backupId/$snapshotId/restore")({
	component: RouteComponent,
	errorComponent: () => <div>Failed to load restore</div>,
	loader: async ({ params, context }) => {
		const schedule = await getBackupSchedule({ path: { shortId: params.backupId } });

		if (!schedule.data) {
			throw new Response("Not Found", { status: 404 });
		}

		const activeRestoreTasksOptions = restoreTasksOptions(schedule.data.repository.shortId, params.snapshotId);
		const [snapshot, repository] = await Promise.all([
			context.queryClient.ensureQueryData({
				...getSnapshotDetailsOptions({
					path: {
						shortId: schedule.data.repository.shortId,
						snapshotId: params.snapshotId,
					},
				}),
			}),
			context.queryClient.ensureQueryData({
				...getRepositoryOptions({ path: { shortId: schedule.data.repository.shortId } }),
			}),
			context.queryClient.ensureQueryData(activeRestoreTasksOptions),
		]);

		const hasNonPosixSnapshotPaths = snapshot.paths.some((path) => !path.startsWith("/"));
		const source = getBackupSource(schedule.data.volume);

		return {
			snapshot,
			repository,
			schedule: schedule.data,
			queryBasePath: hasNonPosixSnapshotPaths ? "/" : findCommonAncestor(snapshot.paths),
			displayBasePath: getVolumeMountPath(schedule.data.volume),
			hasNonPosixSnapshotPaths,
			volumeReadOnly: schedule.data.volume.config?.readOnly ?? false,
			sourceOrigin:
				source.kind === "filesystem" && source.agentKind === "remote"
					? ("remote" as const)
					: ("local" as const),
		};
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
	staticData: {
		breadcrumb: (match) => [
			{ label: "Backup Jobs", href: "/backups" },
			{
				label: match.loaderData?.schedule?.name || "Job",
				href: `/backups/${match.params.backupId}`,
			},
			{ label: match.params.snapshotId },
			{ label: "Restore" },
		],
	},
});

function RouteComponent() {
	const { backupId } = Route.useParams();
	const {
		snapshot,
		repository,
		queryBasePath,
		displayBasePath,
		hasNonPosixSnapshotPaths,
		volumeReadOnly,
		sourceOrigin,
	} = Route.useLoaderData();

	return (
		<RestoreSnapshotPage
			returnPath={`/backups/${backupId}`}
			repository={repository}
			queryBasePath={queryBasePath}
			displayBasePath={displayBasePath}
			hasNonPosixSnapshotPaths={hasNonPosixSnapshotPaths}
			volumeReadOnly={volumeReadOnly}
			sourceOrigin={sourceOrigin}
			snapshot={snapshot}
		/>
	);
}
