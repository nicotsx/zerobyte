import { createFileRoute } from "@tanstack/react-router";
import { listRepositoriesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { RepositoriesPage } from "~/client/modules/repositories/routes/repositories";

export const Route = createFileRoute("/(dashboard)/repositories/")({
	component: RouteComponent,
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData({
			...listRepositoriesOptions(),
		});
	},
	errorComponent: (e) => <div>{e.error.message}</div>,
	head: () => ({
		meta: [
			{ title: "Zerobyte - Repositories" },
			{
				name: "description",
				content: "Manage your backup repositories with encryption and compression.",
			},
		],
	}),
});

function RouteComponent() {
	return <RepositoriesPage />;
}
