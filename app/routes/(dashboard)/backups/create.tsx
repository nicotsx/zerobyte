import { createFileRoute } from "@tanstack/react-router";
import { listRepositoriesOptions, listVolumesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { CreateBackupPage } from "~/client/modules/backups/routes/create-backup";

export const Route = createFileRoute("/(dashboard)/backups/create")({
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData({ ...listVolumesOptions() }),
			context.queryClient.ensureQueryData({ ...listRepositoriesOptions() }),
		]);
	},
	staticData: {
		breadcrumb: () => [
			{ label: "Backup Jobs", href: "/backups" },
			{ label: "Create" },
		],
	},
	component: RouteComponent,
});

function RouteComponent() {
	return <CreateBackupPage />;
}
