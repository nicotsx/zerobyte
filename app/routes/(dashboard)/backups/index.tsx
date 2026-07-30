import { createFileRoute } from "@tanstack/react-router";
import { listBackupSchedulesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { backupTasksOptions } from "~/client/modules/backups/backup-tasks";
import { BackupsPage } from "~/client/modules/backups/routes/backups";

export const Route = createFileRoute("/(dashboard)/backups/")({
	component: RouteComponent,
	errorComponent: () => <div>Failed to load backups</div>,
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData({
				...listBackupSchedulesOptions(),
			}),
			context.queryClient.ensureQueryData(backupTasksOptions()),
		]);
	},
	staticData: {
		breadcrumb: () => [{ label: "Backup Jobs" }],
	},
	head: () => ({
		meta: [
			{ title: "Zerobyte - Backup Jobs" },
			{
				name: "description",
				content: "Automate volume backups with scheduled jobs and retention policies.",
			},
		],
	}),
});

function RouteComponent() {
	return <BackupsPage />;
}
