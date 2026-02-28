import { createFileRoute } from "@tanstack/react-router";
import { fetchUser } from "../route";
import type { AppContext } from "~/context";
import { SettingsPage } from "~/client/modules/settings/routes/settings";
import { z } from "zod";
import { getOrganizationContext } from "~/server/lib/functions/organization-context";
import { getOrgMembersOptions, getSsoSettingsOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { getOrigin } from "~/client/functions/get-origin";

export const Route = createFileRoute("/(dashboard)/settings/")({
	component: RouteComponent,
	validateSearch: z.object({ tab: z.string().optional() }),
	errorComponent: () => <div>Failed to load settings</div>,
	loader: async ({ context }) => {
		const [authContext, orgContext] = await Promise.all([
			fetchUser(),
			context.queryClient.ensureQueryData({
				queryKey: ["organization-context"],
				queryFn: () => getOrganizationContext(),
			}),
		]);
		const orgRole = orgContext.activeMember?.role;
		const shouldPrefetchOrgQueries = orgRole === "owner" || orgRole === "admin";

		if (shouldPrefetchOrgQueries) {
			const [org, members, appOrigin] = await Promise.all([
				context.queryClient.ensureQueryData({ ...getSsoSettingsOptions() }),
				context.queryClient.ensureQueryData({ ...getOrgMembersOptions() }),
				context.queryClient.ensureQueryData({ queryKey: ["app-origin"], queryFn: () => getOrigin() }),
			]);

			return {
				authContext: authContext as AppContext,
				org,
				members,
				appOrigin,
			};
		}

		return { authContext: authContext as AppContext };
	},
	staticData: {
		breadcrumb: () => [{ label: "Settings" }],
	},
});

function RouteComponent() {
	const { authContext, members, org, appOrigin } = Route.useLoaderData();

	return (
		<SettingsPage
			appContext={authContext}
			initialMembers={members}
			initialSsoSettings={org}
			initialOrigin={appOrigin}
		/>
	);
}
