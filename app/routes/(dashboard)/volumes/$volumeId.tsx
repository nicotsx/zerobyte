import { createFileRoute } from "@tanstack/react-router";
import { type } from "arktype";
import { getVolumeOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { VolumeDetails } from "~/client/modules/volumes/routes/volume-details";

export const Route = createFileRoute("/(dashboard)/volumes/$volumeId")({
	component: RouteComponent,
	loader: async ({ params, context }) => {
		const res = await context.queryClient.ensureQueryData({
			...getVolumeOptions({ path: { id: params.volumeId } }),
		});

		return res;
	},
	validateSearch: type({ tab: "string?" }),
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
