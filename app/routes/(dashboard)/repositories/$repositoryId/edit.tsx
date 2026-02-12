import { createFileRoute } from "@tanstack/react-router";
import { getRepositoryOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { EditRepositoryPage } from "~/client/modules/repositories/routes/edit-repository";

export const Route = createFileRoute("/(dashboard)/repositories/$repositoryId/edit")({
	component: RouteComponent,
	errorComponent: (e) => <div>{e.error.message}</div>,
	loader: async ({ params, context }) => {
		const repository = await context.queryClient.ensureQueryData({
			...getRepositoryOptions({ path: { id: params.repositoryId } }),
		})

		return repository;
	},
	staticData: {
		breadcrumb: (match) => [
			{ label: "Repositories", href: "/repositories" },
			{ label: match.loaderData?.name || "Repository", href: `/repositories/${match.params.repositoryId}` },
			{ label: "Edit" },
		],
	},
	head: ({ loaderData }) => ({
		meta: [
			{ title: `Zerobyte - Edit ${loaderData?.name ?? "Repository"}` },
			{
				name: "description",
				content: "Edit repository configuration.",
			},
		],
	}),
});

function RouteComponent() {
	const { repositoryId } = Route.useParams();

	return <EditRepositoryPage repositoryId={repositoryId} />;
}
