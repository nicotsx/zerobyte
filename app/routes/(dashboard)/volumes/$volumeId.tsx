import { createFileRoute } from "@tanstack/react-router";
import { type } from "arktype";
import { getVolumeOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { VolumeDetails } from "~/client/modules/volumes/routes/volume-details";

export const Route = createFileRoute("/(dashboard)/volumes/$volumeId")({
	component: RouteComponent,
	errorComponent: (e) => <div>{e.error.message}</div>,
	loader: async ({ params, context }) => {
		const res = await context.queryClient.ensureQueryData({
			...getVolumeOptions({ path: { id: params.volumeId } }),
		});

		return res;
	},
	validateSearch: type({ tab: "string?" }),
	staticData: {
		breadcrumb: (match) => [
			{ label: "Volumes", href: "/volumes" },
			{ label: match.loaderData?.volume.name || "Volume Details" },
		],
	},
	head: ({ loaderData }) => ({
		meta: [
			{ title: `Zerobyte - ${loaderData?.volume.name}` },
			{
				name: "description",
				content: "View and manage volume details, configuration, and files.",
			},
		],
	}),
});

function RouteComponent() {
	return <VolumeDetails volumeId={Route.useParams().volumeId} />;
}
