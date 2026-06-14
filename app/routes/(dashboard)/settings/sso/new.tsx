import { createFileRoute, redirect } from "@tanstack/react-router";
import { CreateSsoProviderPage } from "~/client/modules/sso/routes/create-sso-provider";

export const Route = createFileRoute("/(dashboard)/settings/sso/new")({
	component: RouteComponent,
	errorComponent: () => <div>Failed to load SSO registration</div>,
	loader: async ({ context }) => {
		if (!context.permissions["ssoProvider.create"]) {
			throw redirect({ to: "/settings" });
		}
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
