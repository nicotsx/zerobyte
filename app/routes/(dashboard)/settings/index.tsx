import { createFileRoute } from "@tanstack/react-router";
import { fetchUser } from "../route";
import type { AppContext } from "~/context";
import { SettingsPage } from "~/client/modules/settings/routes/settings";
import { type } from "arktype";
import { getOrgMembersOptions, getSsoSettingsOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { getOrigin } from "~/client/functions/get-origin";

export const Route = createFileRoute("/(dashboard)/settings/")({
	component: RouteComponent,
	validateSearch: type({ tab: "string?" }),
	loader: async ({ context }) => {
		const [authContext, org, members] = await Promise.all([
			fetchUser(),
			context.queryClient.ensureQueryData({ ...getSsoSettingsOptions() }),
			context.queryClient.ensureQueryData({ ...getOrgMembersOptions() }),
			context.queryClient.ensureQueryData({ queryKey: ["app-origin"], queryFn: () => getOrigin() }),
		]);

		return { authContext: authContext as AppContext, org, members };
	},
	staticData: {
		breadcrumb: () => [{ label: "Settings" }],
	},
});

function RouteComponent() {
	const { authContext, org, members } = Route.useLoaderData();

	return <SettingsPage appContext={authContext} initialMembers={members} initialSsoSettings={org} />;
}
