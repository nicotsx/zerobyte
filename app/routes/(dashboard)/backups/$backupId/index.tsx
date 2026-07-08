import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import {
	getBackupProgressOptions,
	getBackupScheduleOptions,
	getScheduleMirrorsOptions,
	getScheduleNotificationsOptions,
	listNotificationDestinationsOptions,
	listRepositoriesOptions,
	listSnapshotsOptions,
} from "~/client/api-client/@tanstack/react-query.gen";
import { SNAPSHOT_TIMELINE_SORT_ORDER_COOKIE_NAME } from "~/client/modules/backups/components/snapshot-timeline";
import { ScheduleDetailsPage } from "~/client/modules/backups/routes/backup-details";
import { deleteSnapshotTasksOptions } from "~/client/modules/repositories/snapshots/delete-tasks";
import { prefetchOrSkip } from "~/utils/prefetch";

const fetchSnapshotTimelineSortOrder = createServerFn({ method: "GET" }).handler(async () => {
	const order = getCookie(SNAPSHOT_TIMELINE_SORT_ORDER_COOKIE_NAME);
	return order === "desc" ? "desc" : "asc";
});

export const Route = createFileRoute("/(dashboard)/backups/$backupId/")({
	component: RouteComponent,
	errorComponent: () => <div>Failed to load backup</div>,
	validateSearch: z.object({ snapshot: z.string().optional() }),
	loader: async ({ params, context }) => {
		const { backupId } = params;

		const [schedule, notifs, repos, scheduleNotifs, mirrors, _progress, snapshotTimelineSortOrder] =
			await Promise.all([
				context.queryClient.ensureQueryData({ ...getBackupScheduleOptions({ path: { shortId: backupId } }) }),
				context.queryClient.ensureQueryData({ ...listNotificationDestinationsOptions() }),
				context.queryClient.ensureQueryData({ ...listRepositoriesOptions() }),
				context.queryClient.ensureQueryData({
					...getScheduleNotificationsOptions({ path: { shortId: backupId } }),
				}),
				context.queryClient.ensureQueryData({ ...getScheduleMirrorsOptions({ path: { shortId: backupId } }) }),
				context.queryClient.ensureQueryData({ ...getBackupProgressOptions({ path: { shortId: backupId } }) }),
				fetchSnapshotTimelineSortOrder(),
			]);

		const snapshotOptions = listSnapshotsOptions({
			path: { shortId: schedule.repository.shortId },
			query: { backupId: schedule.shortId },
		});
		const deleteTasksOptions = deleteSnapshotTasksOptions(schedule.repository.shortId);

		await Promise.all([
			prefetchOrSkip(context.queryClient, snapshotOptions),
			context.queryClient.ensureQueryData(deleteTasksOptions),
		]);

		return {
			schedule,
			notifs,
			repos,
			scheduleNotifs,
			mirrors,
			snapshotTimelineSortOrder,
			snapshots: context.queryClient.getQueryData(snapshotOptions.queryKey),
		};
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

	return (
		<ScheduleDetailsPage
			loaderData={loaderData}
			scheduleId={backupId}
			initialSnapshotId={search.snapshot}
			initialSnapshotSortOrder={loaderData.snapshotTimelineSortOrder}
		/>
	);
}
