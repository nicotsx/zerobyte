import { createFileRoute, redirect } from "@tanstack/react-router";
import { CreateSsoProviderPage } from "~/client/modules/settings/routes/create-sso-provider";
import { fetchUser } from "../../route";

export const Route = createFileRoute("/(dashboard)/settings/sso/new")({
	component: RouteComponent,
	loader: async () => {
		const authContext = await fetchUser();

		if (authContext.user?.role !== "admin") {
			throw redirect({ to: "/settings" });
		}

		return authContext;
	},
	staticData: {
		breadcrumb: () => [{ label: "Settings", href: "/settings" }, { label: "Register SSO Provider" }],
	},
	head: () => ({
		meta: [
			{ title: "Zerobyte - Register SSO Provider" },
			{
				name: "description",
				content: "Register a new OIDC identity provider for organization sign-in.",
			},
		],
	}),
});

function RouteComponent() {
	return <CreateSsoProviderPage />;
}
