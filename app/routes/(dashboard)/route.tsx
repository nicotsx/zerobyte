import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { Layout } from "~/client/components/layout";
import { authMiddleware } from "~/middleware/auth";
import { auth } from "~/server/lib/auth";
import { authService } from "~/server/modules/auth/auth.service";

export const fetchUser = createServerFn({ method: "GET" }).handler(async () => {
	const headers = getRequestHeaders();
	const session = await auth.api.getSession({ headers });
	const hasUsers = await authService.hasUsers();

	return { user: session?.user ?? null, hasUsers };
});

export const Route = createFileRoute("/(dashboard)")({
	component: PathlessLayoutComponent,
	errorComponent: (e) => <div>{e.error.message}</div>,
	server: {
		middleware: [authMiddleware],
	},
	loader: async () => {
		const authContext = await fetchUser();
		return authContext;
	},
});

function PathlessLayoutComponent() {
	const loaderData = Route.useLoaderData();

	return <Layout loaderData={loaderData} />;
}
