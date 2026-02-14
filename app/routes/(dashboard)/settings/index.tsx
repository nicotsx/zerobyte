import { createFileRoute } from "@tanstack/react-router";
import { fetchUser } from "../route";
import type { AppContext } from "~/context";
import { SettingsPage } from "~/client/modules/settings/routes/settings";
import { type } from "arktype";
import { getAdminUsersOptions, getSsoSettingsOptions } from "~/client/api-client/@tanstack/react-query.gen";

export const Route = createFileRoute("/(dashboard)/settings/")({
	component: RouteComponent,
	validateSearch: type({ tab: "string?" }),
	loader: async ({ context }) => {
		const authContext = await fetchUser();

		if (authContext.user?.role === "admin") {
			await Promise.all([
				context.queryClient.ensureQueryData(getSsoSettingsOptions()),
				context.queryClient.ensureQueryData(getAdminUsersOptions()),
			]);
		}

		return authContext as AppContext;
	},
	staticData: {
		breadcrumb: () => [{ label: "Settings" }],
	},
});

function RouteComponent() {
	const appContext = Route.useLoaderData();
	return <SettingsPage appContext={appContext} />;
}
