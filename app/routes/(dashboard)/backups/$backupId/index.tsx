import { createFileRoute } from "@tanstack/react-router";
import { type } from "arktype";
import {
	getBackupScheduleOptions,
	getScheduleMirrorsOptions,
	getScheduleNotificationsOptions,
	listNotificationDestinationsOptions,
	listRepositoriesOptions,
	listSnapshotsOptions,
} from "~/client/api-client/@tanstack/react-query.gen";
import { ScheduleDetailsPage } from "~/client/modules/backups/routes/backup-details";

export const Route = createFileRoute("/(dashboard)/backups/$backupId/")({
	component: RouteComponent,
	validateSearch: type({ snapshot: "string?" }),
	loader: async ({ params, context }) => {
		const { backupId } = params;

		const [schedule, notifs, repos, scheduleNotifs, mirrors] = await Promise.all([
			context.queryClient.ensureQueryData({ ...getBackupScheduleOptions({ path: { shortId: backupId } }) }),
			context.queryClient.ensureQueryData({ ...listNotificationDestinationsOptions() }),
			context.queryClient.ensureQueryData({ ...listRepositoriesOptions() }),
			context.queryClient.ensureQueryData({ ...getScheduleNotificationsOptions({ path: { shortId: backupId } }) }),
			context.queryClient.ensureQueryData({ ...getScheduleMirrorsOptions({ path: { shortId: backupId } }) }),
		]);

		void context.queryClient.prefetchQuery({
			...listSnapshotsOptions({
				path: { shortId: schedule.repository.shortId },
				query: { backupId: schedule.shortId },
			}),
		});

		return { schedule, notifs, repos, scheduleNotifs, mirrors };
	},
	staticData: {
		breadcrumb: (match) => [
			{ label: "Backup Jobs", href: "/backups" },
			{ label: match.loaderData?.schedule.name || "Job Details" },
		],
	},
	head: ({ loaderData }) => ({
		meta: [
			{ title: `Zerobyte - ${loaderData?.schedule.name || "Backup Job Details"}` },
			{
				name: "description",
				content: "View and manage backup job configuration, schedule, and snapshots.",
			},
		],
	}),
});

function RouteComponent() {
	const loaderData = Route.useLoaderData();
	const { backupId } = Route.useParams();
	const search = Route.useSearch();

	return <ScheduleDetailsPage loaderData={loaderData} scheduleId={backupId} initialSnapshotId={search.snapshot} />;
}
