import { createFileRoute } from "@tanstack/react-router";
import { fetchUser } from "../route";
import type { AppContext } from "~/context";
import { SettingsPage } from "~/client/modules/settings/routes/settings";
import { type } from "arktype";

export const Route = createFileRoute("/(dashboard)/settings/")({
	component: RouteComponent,
	validateSearch: type({ tab: "string?" }),
	loader: async () => {
		const authContext = await fetchUser();
		return authContext as AppContext;
	},
});

function RouteComponent() {
	const appContext = Route.useLoaderData();
	return <SettingsPage appContext={appContext} />;
}
