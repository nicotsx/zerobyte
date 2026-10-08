import { createFileRoute } from "@tanstack/react-router";
import { RouteError } from "~/client/components/route-error";
import { listVolumesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { VolumesPage } from "~/client/modules/volumes/routes/volumes";

export const Route = createFileRoute("/(dashboard)/volumes/")({
	component: VolumesPage,
	errorComponent: RouteError,
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(listVolumesOptions());
	},
	staticData: {
		breadcrumb: () => [{ label: "Sources" }],
	},
	head: () => ({
		meta: [
			{ title: "Zerobyte - Sources" },
			{
				name: "description",
				content: "Create, manage, and monitor the files and folders you back up.",
			},
		],
	}),
});
