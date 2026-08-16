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

			const membersPromise = canManageOrganizationMembers
				? context.queryClient.ensureQueryData({ ...getOrgMembersOptions() })
				: Promise.resolve(undefined);

			const ssoSettingsPromise = canManageSso
				? context.queryClient.ensureQueryData({ ...getSsoSettingsOptions() })
				: Promise.resolve(undefined);

			const appOriginPromise = canManageSso
				? context.queryClient.ensureQueryData({ queryKey: ["app-origin"], queryFn: () => getOrigin() })
				: Promise.resolve(undefined);

			const [authContext, members, org, appOrigin] = await Promise.all([
				authContextPromise,
				membersPromise,
				ssoSettingsPromise,
				appOriginPromise,
				organizationContextPromise,
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

			const adminUsersPromise = canManageInstanceUsers
				? context.queryClient.ensureQueryData({ ...getAdminUsersOptions() })
				: Promise.resolve(undefined);

			const registrationStatusPromise = canManageRegistration
				? context.queryClient.ensureQueryData({ ...getRegistrationStatusOptions() })
				: Promise.resolve(undefined);

			const passwordLoginStatusPromise = canManagePasswordLogin
				? context.queryClient.ensureQueryData({ ...getPasswordLoginStatusOptions() })
				: Promise.resolve(undefined);

			const [authContext] = await Promise.all([
				authContextPromise,
				adminUsersPromise,
				registrationStatusPromise,
				passwordLoginStatusPromise,
			]);

			return { authContext: authContext as AppContext, userInvitations: [] };
		}

		const shouldFetchInvitations = context.features.ssoManagement;
		const userInvitationsPromise = shouldFetchInvitations
			? context.queryClient.ensureQueryData({ ...getUserSsoInvitationsOptions() })
			: Promise.resolve([]);

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
