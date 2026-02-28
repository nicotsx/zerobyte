import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
	getRepositoryOptions,
	getRepositoryStatsOptions,
	listBackupSchedulesOptions,
	listSnapshotsOptions,
} from "~/client/api-client/@tanstack/react-query.gen";
import RepositoryDetailsPage from "~/client/modules/repositories/routes/repository-details";
import { prefetchOrSkip } from "~/utils/prefetch";

export const Route = createFileRoute("/(dashboard)/repositories/$repositoryId/")({
	component: RouteComponent,
	errorComponent: (e) => <div>{e.error.message}</div>,
	loader: async ({ params, context }) => {
		const snapshotOptions = listSnapshotsOptions({ path: { shortId: params.repositoryId } });
		const statsOptions = getRepositoryStatsOptions({ path: { shortId: params.repositoryId } });

		const [res, schedules] = await Promise.all([
			context.queryClient.ensureQueryData(getRepositoryOptions({ path: { shortId: params.repositoryId } })),
			context.queryClient.ensureQueryData(listBackupSchedulesOptions()),
			prefetchOrSkip(context.queryClient, snapshotOptions),
			prefetchOrSkip(context.queryClient, statsOptions),
		]);

		return {
			...res,
			snapshots: context.queryClient.getQueryData(snapshotOptions.queryKey),
			backupSchedules: schedules,
			stats: context.queryClient.getQueryData(statsOptions.queryKey),
		};
	},
	validateSearch: z.object({ tab: z.string().optional() }),
	staticData: {
		breadcrumb: (match) => [
			{ label: "Repositories", href: "/repositories" },
			{ label: match.loaderData?.name || "Repository Details" },
		],
	},
	head: ({ loaderData }) => ({
		meta: [
			{ title: `Zerobyte - ${loaderData?.name}` },
			{
				name: "description",
				content: "View repository configuration, status, and snapshots.",
			},
		],
	}),
});

function RouteComponent() {
	const { repositoryId } = Route.useParams();
	const { snapshots, backupSchedules, stats } = Route.useLoaderData();

	return (
		<RepositoryDetailsPage
			repositoryId={repositoryId}
			initialSnapshots={snapshots}
			initialBackupSchedules={backupSchedules}
			initialStats={stats}
		/>
	);
}
