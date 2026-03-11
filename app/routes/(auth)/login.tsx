import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { z } from "zod";
import { LoginPage } from "~/client/modules/auth/routes/login";

export const Route = createFileRoute("/(auth)/login")({
	component: RouteComponent,
	errorComponent: () => <div>Failed to load login</div>,
	validateSearch: z.object({ error: z.string().optional() }),
	head: () => ({
		meta: [
			{ title: "Zerobyte - Login" },
			{
				name: "description",
				content: "Sign in to your Zerobyte account.",
			},
		],
	}),
});

function RouteComponent() {
	const { error } = Route.useSearch();
	const pathname = useRouterState({ select: (state) => state.location.pathname });

	if (pathname !== "/login") {
		return <Outlet />;
	}

	return <LoginPage error={error} />;
}
