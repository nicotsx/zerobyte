import { createFileRoute } from "@tanstack/react-router";
import { type } from "arktype";
import { LoginPage } from "~/client/modules/auth/routes/login";

export const Route = createFileRoute("/(auth)/login/error")({
	component: RouteComponent,
	validateSearch: type({ error: "string?" }),
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
