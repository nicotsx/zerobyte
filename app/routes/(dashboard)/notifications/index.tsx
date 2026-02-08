import { createFileRoute } from "@tanstack/react-router";
import { listNotificationDestinationsOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { NotificationsPage } from "~/client/modules/notifications/routes/notifications";

export const Route = createFileRoute("/(dashboard)/notifications/")({
	component: RouteComponent,
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData({ ...listNotificationDestinationsOptions() });
	},
	staticData: {
		breadcrumb: () => [{ label: "Notifications" }],
	},
	head: () => ({
		meta: [
			{ title: "Zerobyte - Notifications" },
			{
				name: "description",
				content: "Manage notification destinations for backup alerts.",
			},
		],
	}),
});

function RouteComponent() {
	return <NotificationsPage />;
}
