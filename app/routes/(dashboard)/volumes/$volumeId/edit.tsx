import { createFileRoute } from "@tanstack/react-router";
import { getVolumeOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { EditVolumePage } from "~/client/modules/volumes/routes/edit-volume";

export const Route = createFileRoute("/(dashboard)/volumes/$volumeId/edit")({
	component: RouteComponent,
	errorComponent: (e) => <div>{e.error.message}</div>,
	loader: async ({ params, context }) => {
		const volume = await context.queryClient.ensureQueryData({
			...getVolumeOptions({ path: { shortId: params.volumeId } }),
		});

		return volume;
	},
	staticData: {
		breadcrumb: (match) => [
			{ label: "Volumes", href: "/volumes" },
			{ label: match.loaderData?.volume.name || "Volume", href: `/volumes/${match.params.volumeId}` },
			{ label: "Edit" },
		],
	},
	head: ({ loaderData }) => ({
		meta: [
			{ title: `Zerobyte - Edit ${loaderData?.volume.name ?? "Volume"}` },
			{
				name: "description",
				content: "Edit volume configuration.",
			},
		],
	}),
});

function RouteComponent() {
	const { volumeId } = Route.useParams();

	return <EditVolumePage volumeId={volumeId} />;
}
