import { createFileRoute } from "@tanstack/react-router";
import { listVolumesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { VolumesPage } from "~/client/modules/volumes/routes/volumes";

export const Route = createFileRoute("/(dashboard)/volumes/")({
	component: VolumesPage,
	errorComponent: (e) => <div>{e.error.message}</div>,
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(listVolumesOptions());
	},
	staticData: {
		breadcrumb: () => [{ label: "Volumes" }],
	},
	head: () => ({
		meta: [
			{ title: "Zerobyte - Volumes" },
			{
				name: "description",
				content: "Create, manage, monitor, and automate your Docker volumes with ease.",
			},
		],
	}),
});
