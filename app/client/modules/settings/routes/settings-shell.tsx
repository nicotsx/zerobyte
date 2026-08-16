import { useSearch } from "@tanstack/react-router";
import type {
	GetOrgMembersResponse,
	GetSsoSettingsResponse,
	GetUserSsoInvitationsResponse,
} from "~/client/api-client/types.gen";
import { usePermissions } from "~/client/hooks/use-permissions";
import { InstanceSettings } from "~/client/modules/settings/components/instance-settings";
import type { AppContext } from "~/context";
import { getActiveSettingsScope, getSettingsScopeAvailability } from "../settings-scope";
import { SettingsPage } from "./settings";

type Props = {
	appContext: AppContext;
	initialUserInvitations: GetUserSsoInvitationsResponse;
	initialMembers?: GetOrgMembersResponse;
	initialSsoSettings?: GetSsoSettingsResponse;
	initialOrigin?: string;
};

export function SettingsShell({
	appContext,
	initialUserInvitations,
	initialMembers,
	initialSsoSettings,
	initialOrigin,
}: Props) {
	const search = useSearch({ from: "/(dashboard)/settings/" });
	const permissions = usePermissions();

	const scopeAvailability = getSettingsScopeAvailability(permissions);
	const activeScope = getActiveSettingsScope(search, scopeAvailability);

	if (activeScope === "instance") {
		return <InstanceSettings appContext={appContext} />;
	}

	return (
		<SettingsPage
			activeScope={activeScope}
			appContext={appContext}
			initialUserInvitations={initialUserInvitations}
			initialMembers={initialMembers}
			initialSsoSettings={initialSsoSettings}
			initialOrigin={initialOrigin}
		/>
	);
}
