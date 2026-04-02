import { createFileRoute } from "@tanstack/react-router";
import { getNotificationDestinationOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { EditNotificationPage } from "~/client/modules/notifications/routes/edit-notification";

export const Route = createFileRoute("/(dashboard)/notifications/$notificationId/edit")({
	component: RouteComponent,
	errorComponent: () => <div>Failed to load notification</div>,
	loader: async ({ params, context }) => {
		const notification = await context.queryClient.ensureQueryData({
			...getNotificationDestinationOptions({ path: { id: params.notificationId } }),
		});

		return notification;
	},
	staticData: {
		breadcrumb: (match) => [
			{ label: "Notifications", href: "/notifications" },
			{
				label: match.loaderData?.name || "Notification Details",
				href: `/notifications/${match.params.notificationId}`,
			},
			{ label: "Edit" },
		],
	},
	head: ({ loaderData }) => ({
		meta: [
			{ title: `Zerobyte - Edit ${loaderData?.name}` },
			{
				name: "description",
				content: "Edit notification destination settings.",
			},
		],
	}),
});

function RouteComponent() {
	return <EditNotificationPage notificationId={Route.useParams().notificationId} />;
}
