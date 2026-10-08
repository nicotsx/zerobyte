import { createFileRoute } from "@tanstack/react-router";
import { fetchUser } from "../route";
import type { AppContext } from "~/context";
import { SettingsShell } from "~/client/modules/settings/routes/settings-shell";
import { z } from "zod";
import { getOrganizationContext } from "~/server/lib/functions/organization-context";
import {
	getOrgMembersOptions,
	getSsoSettingsOptions,
	getUserSsoInvitationsOptions,
	getAdminUsersOptions,
	getPasswordLoginStatusOptions,
	getRegistrationStatusOptions,
	listAgentsOptions,
} from "~/client/api-client/@tanstack/react-query.gen";
import { getOrigin } from "~/client/functions/get-origin";
import { getActiveSettingsScope, getSettingsScopeAvailability } from "~/client/modules/settings/settings-scope";
import type { Permission } from "~/lib/permission-policy";

export const Route = createFileRoute("/(dashboard)/settings/")({
	component: RouteComponent,
	validateSearch: z.object({
		scope: z.enum(["personal", "organization", "instance"]).optional(),
		tab: z.enum(["account", "organization"]).optional(),
	}),
	errorComponent: () => <div>Failed to load settings</div>,
	loaderDeps: ({ search }) => {
		const scope = search.scope;
		const tab = search.tab;

		return { scope, tab };
	},
	loader: async ({ context, deps }) => {
		const permissionChecker = {
			can(permission: Permission) {
				return context.permissions[permission];
			},
		};

		const scopeAvailability = getSettingsScopeAvailability(permissionChecker);
		const canManageOrganizationMembers = context.permissions["organizationMembers.manage"];
		const canManageSso = context.permissions["sso.manage"];
		const activeScope = getActiveSettingsScope(deps, scopeAvailability);
		const authContextPromise = fetchUser();

		if (activeScope === "organization") {
			const organizationContextPromise = context.queryClient.ensureQueryData({
				queryKey: ["organization-context"],
				queryFn: () => getOrganizationContext(),
			});

			let membersPromise;
			if (canManageOrganizationMembers) {
				membersPromise = context.queryClient.ensureQueryData({ ...getOrgMembersOptions() });
			}

			let machinesPromise;
			if (context.permissions["agents.manage"] && context.features.remoteAgents) {
				machinesPromise = context.queryClient.ensureQueryData(listAgentsOptions());
			}

			let ssoSettingsPromise;
			if (canManageSso) {
				ssoSettingsPromise = context.queryClient.ensureQueryData({ ...getSsoSettingsOptions() });
			}

			let appOriginPromise;
			if (canManageSso) {
				appOriginPromise = context.queryClient.ensureQueryData({
					queryKey: ["app-origin"],
					queryFn: () => getOrigin(),
				});
			}

			const [authContext, members, org, appOrigin] = await Promise.all([
				authContextPromise,
				membersPromise,
				ssoSettingsPromise,
				appOriginPromise,
				organizationContextPromise,
				machinesPromise,
			]);

			return {
				authContext: authContext as AppContext,
				userInvitations: [],
				org,
				members,
				appOrigin,
			};
		}

		if (activeScope === "instance") {
			const canManageInstanceUsers = context.permissions["instanceUsers.manage"];
			const canManageRegistration = context.permissions["registration.manage"];
			const canManagePasswordLogin = context.permissions["passwordLogin.manage"];

			let adminUsersPromise;
			if (canManageInstanceUsers) {
				adminUsersPromise = context.queryClient.ensureQueryData({ ...getAdminUsersOptions() });
			}

			let registrationStatusPromise;
			if (canManageRegistration) {
				registrationStatusPromise = context.queryClient.ensureQueryData({ ...getRegistrationStatusOptions() });
			}

			let passwordLoginStatusPromise;
			if (canManagePasswordLogin) {
				passwordLoginStatusPromise = context.queryClient.ensureQueryData({
					...getPasswordLoginStatusOptions(),
				});
			}

			const [authContext] = await Promise.all([
				authContextPromise,
				adminUsersPromise,
				registrationStatusPromise,
				passwordLoginStatusPromise,
			]);

			return { authContext: authContext as AppContext, userInvitations: [] };
		}

		const shouldFetchInvitations = context.features.ssoManagement;
		let userInvitationsPromise;
		if (shouldFetchInvitations) {
			userInvitationsPromise = context.queryClient.ensureQueryData({ ...getUserSsoInvitationsOptions() });
		} else {
			userInvitationsPromise = Promise.resolve([]);
		}

		const [authContext, userInvitations] = await Promise.all([authContextPromise, userInvitationsPromise]);

		return {
			authContext: authContext as AppContext,
			userInvitations,
		};
	},
	staticData: {
		breadcrumb: () => [{ label: "Settings" }],
	},
});

function RouteComponent() {
	const { authContext, members, org, appOrigin, userInvitations } = Route.useLoaderData();

	return (
		<SettingsShell
			appContext={authContext}
			initialUserInvitations={userInvitations}
			initialMembers={members}
			initialSsoSettings={org}
			initialOrigin={appOrigin}
		/>
	);
}
