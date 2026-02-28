import { createFileRoute } from "@tanstack/react-router";
import { fetchUser } from "../route";
import type { AppContext } from "~/context";
import { SettingsPage } from "~/client/modules/settings/routes/settings";
import { type } from "arktype";
import { getOrgMembersOptions, getSsoSettingsOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { getOrigin } from "~/client/functions/get-origin";
import { getOrganizationContext } from "~/server/lib/functions/organization-context";

export const Route = createFileRoute("/(dashboard)/settings/")({
	component: RouteComponent,
	validateSearch: type({ tab: "string?" }),
	errorComponent: () => <div>Failed to load settings</div>,
	loader: async ({ context }) => {
		const authContext = await fetchUser();
		const orgContext = await getOrganizationContext();
		const orgRole = orgContext.activeMember?.role;

		let org, members;

		if (authContext.user?.role === "admin" || orgRole === "owner" || orgRole === "admin") {
			const promises = await Promise.all([
				context.queryClient.ensureQueryData({ ...getSsoSettingsOptions() }),
				context.queryClient.ensureQueryData({ ...getOrgMembersOptions() }),
				context.queryClient.ensureQueryData({ queryKey: ["app-origin"], queryFn: () => getOrigin() }),
			]);
			org = promises[0];
			members = promises[1];
		}

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
