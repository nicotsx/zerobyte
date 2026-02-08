import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { Layout } from "~/client/components/layout";
import type { AppContext } from "~/context";
import { authMiddleware } from "~/middleware/auth";
import { auth } from "~/server/lib/auth";

export const fetchUser = createServerFn({ method: "GET" }).handler(async () => {
	const headers = getRequestHeaders();
	const session = await auth.api.getSession({ headers });

	return { user: session?.user, hasUsers: true };
});

export const Route = createFileRoute("/(dashboard)")({
	component: PathlessLayoutComponent,
	errorComponent: (e) => <div>{e.error.message}</div>,
	server: {
		middleware: [authMiddleware],
	},
	loader: async () => {
		const authContext = await fetchUser();
		return authContext as AppContext;
	},
});

function PathlessLayoutComponent() {
	const loaderData = Route.useLoaderData();

	return <Layout loaderData={loaderData} />;
}
