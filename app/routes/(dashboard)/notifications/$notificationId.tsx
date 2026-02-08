import { createFileRoute } from "@tanstack/react-router";
import { getNotificationDestinationOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { NotificationDetailsPage } from "~/client/modules/notifications/routes/notification-details";

export const Route = createFileRoute("/(dashboard)/notifications/$notificationId")({
	component: RouteComponent,
	loader: async ({ params, context }) => {
		const res = await context.queryClient.ensureQueryData({
			...getNotificationDestinationOptions({ path: { id: params.notificationId } }),
		});

		return res;
	},
	head: ({ loaderData }) => ({
		meta: [
			{ title: `Zerobyte - ${loaderData?.name}` },
			{
				name: "description",
				content: "View and edit notification destination settings.",
			},
		],
	}),
});

function RouteComponent() {
	return <NotificationDetailsPage notificationId={Route.useParams().notificationId} />;
}
