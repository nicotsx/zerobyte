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
import { useSystemInfo } from "~/client/hooks/use-system-info";
import { Card } from "~/client/components/ui/card";
import { DateTimeFormatSection } from "../components/date-time-format-section";
import { RecoveryKeySection } from "../components/recovery-key-section";

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
	const { runtime } = useSystemInfo();

	if (runtime === "desktop") {
		const showRecoveryKey = permissions.can("recoveryKey.download");
		const hasPassword = appContext.user?.hasPassword === true;
		return (
			<div className="space-y-6">
				<Card className="p-0 gap-0">
					<DateTimeFormatSection />
				</Card>
				{showRecoveryKey && (
					<Card id="recovery-key" className="scroll-mt-20 p-0 gap-0">
						<RecoveryKeySection
							passwordAuthSupported={appContext.passwordAuthSupported}
							hasPassword={hasPassword}
						/>
					</Card>
				)}
			</div>
		);
	}

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
