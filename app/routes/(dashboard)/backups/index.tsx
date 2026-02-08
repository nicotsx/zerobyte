import { createFileRoute } from "@tanstack/react-router";
import { listBackupSchedulesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { BackupsPage } from "~/client/modules/backups/routes/backups";

export const Route = createFileRoute("/(dashboard)/backups/")({
	component: RouteComponent,
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData({
			...listBackupSchedulesOptions(),
		});
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
