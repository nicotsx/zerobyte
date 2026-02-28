import { createFileRoute, redirect } from "@tanstack/react-router";
import { type } from "arktype";
import { fetchUser } from "../route";
import type { AppContext } from "~/context";
import { AdminPage } from "~/client/modules/admin/routes/admin-page";
import { getAdminUsersOptions } from "~/client/api-client/@tanstack/react-query.gen";

export const Route = createFileRoute("/(dashboard)/admin/")({
	validateSearch: type({ tab: "string?" }),
	component: RouteComponent,
	loader: async ({ context }) => {
		const authContext = await fetchUser();

		if (authContext.user?.role !== "admin") {
			throw redirect({ to: "/settings" });
		}

		await context.queryClient.ensureQueryData(getAdminUsersOptions());

		return authContext as AppContext;
	},
	staticData: {
		breadcrumb: () => [{ label: "Administration" }],
	},
});

function RouteComponent() {
	const appContext = Route.useLoaderData();
	return <AdminPage appContext={appContext} />;
}
