import { createFileRoute } from "@tanstack/react-router";
import { CreateVolumePage } from "~/client/modules/volumes/routes/create-volume";

export const Route = createFileRoute("/(dashboard)/volumes/create")({
	component: RouteComponent,
	staticData: {
		breadcrumb: () => [{ label: "Volumes", href: "/volumes" }, { label: "Create" }],
	},
	head: () => ({
		meta: [
			{ title: "Zerobyte - Create Volume" },
			{
				name: "description",
				content: "Create a new storage volume with automatic mounting and health checks.",
			},
		],
	}),
});

function RouteComponent() {
	return <CreateVolumePage />;
}
