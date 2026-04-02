import { createFileRoute } from "@tanstack/react-router";
import { getBackupScheduleOptions, listRepositoriesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { EditBackupPage } from "~/client/modules/backups/routes/edit-backup";

export const Route = createFileRoute("/(dashboard)/backups/$backupId/edit")({
	component: RouteComponent,
	errorComponent: () => <div>Failed to load backup</div>,
	loader: async ({ params, context }) => {
		const schedule = await context.queryClient.ensureQueryData({
			...getBackupScheduleOptions({ path: { shortId: params.backupId } }),
		});

		await context.queryClient.ensureQueryData({
			...listRepositoriesOptions(),
		});

		return schedule;
	},
	staticData: {
		breadcrumb: (match) => [
			{ label: "Backup Jobs", href: "/backups" },
			{ label: match.loaderData?.name || "Job Details", href: `/backups/${match.params.backupId}` },
			{ label: "Edit" },
		],
	},
	head: ({ loaderData }) => ({
		meta: [
			{ title: `Zerobyte - Edit ${loaderData?.name || "Backup Job"}` },
			{
				name: "description",
				content: "Edit backup job configuration and schedule.",
			},
		],
	}),
});

function RouteComponent() {
	const { backupId } = Route.useParams();

	return <EditBackupPage backupId={backupId} />;
}
