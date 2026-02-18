import { createFileRoute } from "@tanstack/react-router";
import { getBackupSchedule } from "~/client/api-client";
import { getRepositoryOptions, getSnapshotDetailsOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { RestoreSnapshotPage } from "~/client/modules/repositories/routes/restore-snapshot";
import { getVolumeMountPath } from "~/client/lib/volume-path";

export const Route = createFileRoute("/(dashboard)/backups/$backupId/$snapshotId/restore")({
	component: RouteComponent,
	loader: async ({ params, context }) => {
		const schedule = await getBackupSchedule({ path: { shortId: params.backupId } });

		if (!schedule.data) {
			throw new Response("Not Found", { status: 404 });
		}

		const [snapshot, repository] = await Promise.all([
			context.queryClient.ensureQueryData({
				...getSnapshotDetailsOptions({
					path: { shortId: schedule.data.repository.shortId, snapshotId: params.snapshotId },
				}),
			}),
			context.queryClient.ensureQueryData({
				...getRepositoryOptions({ path: { shortId: schedule.data.repository.shortId } }),
			}),
		]);

		return {
			snapshot,
			repository,
			schedule: schedule.data,
			basePath: getVolumeMountPath(schedule.data.volume),
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
			{ label: match.loaderData?.schedule?.name || "Job", href: `/backups/${match.params.backupId}` },
			{ label: match.params.snapshotId },
			{ label: "Restore" },
		],
	},
});

function RouteComponent() {
	const { backupId, snapshotId } = Route.useParams();
	const { repository, basePath } = Route.useLoaderData();

	return (
		<RestoreSnapshotPage
			returnPath={`/backups/${backupId}`}
			snapshotId={snapshotId}
			repository={repository}
			basePath={basePath}
		/>
	);
}
