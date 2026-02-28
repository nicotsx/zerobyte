import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { LoginPage } from "~/client/modules/auth/routes/login";

export const Route = createFileRoute("/(auth)/login/error")({
	component: RouteComponent,
	errorComponent: () => <div>Failed to load login error</div>,
	validateSearch: z.object({ error: z.string().optional() }),
	head: () => ({
		meta: [
			{ title: "Zerobyte - Login Error" },
			{
				name: "description",
				content: "Resolve SSO sign-in errors.",
			},
		],
	}),
});

function RouteComponent() {
	const { error } = Route.useSearch();

	return <LoginPage error={error} />;
}
