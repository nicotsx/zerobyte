import { createFileRoute } from "@tanstack/react-router";
import { CreateNotificationPage } from "~/client/modules/notifications/routes/create-notification";

export const Route = createFileRoute("/(dashboard)/notifications/create")({
	component: RouteComponent,
	staticData: {
		breadcrumb: () => [
			{ label: "Notifications", href: "/notifications" },
			{ label: "Create" },
		],
	},
	head: () => ({
		meta: [
			{ title: "Zerobyte - Create Notification" },
			{
				name: "description",
				content: "Create a new notification destination for backup alerts.",
			},
		],
	}),
});

function RouteComponent() {
	return <CreateNotificationPage />;
}
