import { createFileRoute } from "@tanstack/react-router";
import { type } from "arktype";
import {
	getRepositoryOptions,
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

		const [res, schedules, snapshots] = await Promise.all([
			context.queryClient.ensureQueryData(getRepositoryOptions({ path: { shortId: params.repositoryId } })),
			context.queryClient.ensureQueryData(listBackupSchedulesOptions()),
			prefetchOrSkip(context.queryClient, snapshotOptions),
		]);

		return {
			...res,
			snapshots: context.queryClient.getQueryData(snapshotOptions.queryKey),
			backupSchedules: schedules,
		};
	},
	validateSearch: type({ tab: "string?" }),
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
	const { snapshots, backupSchedules } = Route.useLoaderData();

	return (
		<RepositoryDetailsPage
			repositoryId={repositoryId}
			initialSnapshots={snapshots}
			initialBackupSchedules={backupSchedules}
		/>
	);
}
