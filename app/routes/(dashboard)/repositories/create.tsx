import { createFileRoute } from "@tanstack/react-router";
import { CreateRepositoryPage } from "~/client/modules/repositories/routes/create-repository";

export const Route = createFileRoute("/(dashboard)/repositories/create")({
	component: RouteComponent,
	errorComponent: () => <div>Failed to load repository creation</div>,
	staticData: {
		breadcrumb: () => [{ label: "Repositories", href: "/repositories" }, { label: "Create" }],
	},
	head: () => ({
		meta: [
			{ title: "Zerobyte - Create Repository" },
			{
				name: "description",
				content: "Create a new backup repository with encryption and compression.",
			},
		],
	}),
});

function RouteComponent() {
	return <CreateRepositoryPage />;
}
