import { Fingerprint, KeyRound, User, Settings as SettingsIcon, Building2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type {
	GetOrgMembersResponse,
	GetSsoSettingsResponse,
	GetUserSsoInvitationsResponse,
} from "~/client/api-client/types.gen";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "~/client/components/ui/card";
import { Input } from "~/client/components/ui/input";
import { Label } from "~/client/components/ui/label";
import { authClient } from "~/client/lib/auth-client";
import { logger } from "~/client/lib/logger";
import { type AppContext } from "~/context";
import { TwoFactorSection } from "../components/two-factor-section";
import { PasskeysSection } from "../components/passkeys-section";
import { ApiKeysSection } from "../components/api-keys-section";
import { useNavigate } from "@tanstack/react-router";
import { SsoSettingsSection } from "~/client/modules/sso/components/sso-settings-section";
import { OrgMembersSection } from "../components/org-members-section";
import { PendingInvitationsSection } from "../components/pending-invitations-section";
import { useOrganizationContext } from "~/client/hooks/use-org-context";
import { DateTimeFormatSection } from "../components/date-time-format-section";
import { usePermissions } from "~/client/hooks/use-permissions";
import { RecoveryKeySection } from "../components/recovery-key-section";

type Props = {
	activeScope: "personal" | "organization";
	appContext: AppContext;
	initialUserInvitations: GetUserSsoInvitationsResponse;
	initialMembers?: GetOrgMembersResponse;
	initialSsoSettings?: GetSsoSettingsResponse;
	initialOrigin?: string;
};

function OrganizationDetailsSection() {
	const { activeOrganization } = useOrganizationContext();

	return (
		<Card className="p-0 gap-0">
			<div className="border-b border-border/50 bg-card-header p-6">
				<CardTitle className="flex items-center gap-2">
					<Fingerprint className="size-5" />
					Organization Details
				</CardTitle>
				<CardDescription className="mt-1.5">Reference details for the active organization</CardDescription>
			</div>
			<CardContent className="p-6 space-y-2">
				<Label htmlFor="organization-id">Organization ID</Label>
				<Input
					id="organization-id"
					value={activeOrganization.id}
					readOnly
					className="max-w-xl font-mono text-sm"
				/>
			</CardContent>
		</Card>
	);
}

export function SettingsPage({
	activeScope,
	appContext,
	initialUserInvitations,
	initialMembers,
	initialSsoSettings,
	initialOrigin,
}: Props) {
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [isChangingPassword, setIsChangingPassword] = useState(false);
	const permissions = usePermissions();

	const navigate = useNavigate();
	const showOrganizationDetails = permissions.can("organizationSettings.view");
	const showOrganizationMembers = permissions.can("organizationMembers.manage");
	const showSsoSettings = permissions.can("sso.manage");
	const showRecoveryKey = permissions.can("recoveryKey.download");
	const passwordAuthSupported = appContext.passwordAuthSupported;
	const hasPassword = appContext.user?.hasPassword === true;

	const handleLogout = async () => {
		await authClient.signOut({
			fetchOptions: {
				onSuccess: () => {
					void navigate({ to: "/login", replace: true });
				},
				onError: ({ error }) => {
					logger.error(error);
					toast.error("Logout failed", { description: error.message });
				},
			},
		});
	};

	const handleChangePassword = async (e: React.SubmitEvent) => {
		e.preventDefault();

		if (newPassword !== confirmPassword) {
			toast.error("Passwords do not match");
			return;
		}

		if (newPassword.length < 8) {
			toast.error("Password must be at least 8 characters long");
			return;
		}

		await authClient.changePassword({
			newPassword,
			currentPassword: currentPassword,
			revokeOtherSessions: true,
			fetchOptions: {
				onSuccess: () => {
					toast.success("Password changed successfully. You will be logged out.");
					setTimeout(() => {
						void handleLogout();
					}, 1500);
				},
				onError: ({ error }) => {
					toast.error("Failed to change password", {
						description: error.message,
					});
				},
				onRequest: () => {
					setIsChangingPassword(true);
				},
				onResponse: () => {
					setIsChangingPassword(false);
				},
			},
		});
	};

	return (
		<div className="space-y-6">
			{activeScope === "personal" && (
				<div>
					<Card className="p-0 gap-0">
						<div className="border-b border-border/50 bg-card-header p-6">
							<CardTitle className="flex items-center gap-2">
								<User className="size-5" />
								Account Information
							</CardTitle>
							<CardDescription className="mt-1.5">Your account details</CardDescription>
						</div>
						<CardContent className="p-6 space-y-4">
							<div className="space-y-2">
								<Label htmlFor="username">Username</Label>
								<Input id="username" value={appContext.user?.username} disabled className="max-w-md" />
							</div>
							<div className="space-y-2">
								<Label htmlFor="email">Email</Label>
								<Input
									id="email"
									type="email"
									value={appContext.user?.email}
									disabled
									className="max-w-md"
								/>
							</div>
						</CardContent>

						{permissions.hasRuntimeFeature("ssoManagement") && (
							<PendingInvitationsSection
								initialInvitations={initialUserInvitations}
								userEmail={appContext.user?.email}
							/>
						)}

						<div className="border-t border-border/50">
							<DateTimeFormatSection />
						</div>

						{hasPassword && (
							<>
								<div className="border-t border-border/50 bg-card-header p-6">
									<CardTitle className="flex items-center gap-2">
										<KeyRound className="size-5" />
										Change Password
									</CardTitle>
									<CardDescription className="mt-1.5">
										Update your password to keep your account secure
									</CardDescription>
								</div>
								<CardContent className="p-6">
									<form onSubmit={handleChangePassword} className="space-y-4">
										<div className="space-y-2">
											<Label htmlFor="current-password">Current Password</Label>
											<Input
												id="current-password"
												type="password"
												value={currentPassword}
												onChange={(e) => setCurrentPassword(e.target.value)}
												className="max-w-md"
												required
											/>
										</div>
										<div className="space-y-2">
											<Label htmlFor="new-password">New Password</Label>
											<Input
												id="new-password"
												type="password"
												value={newPassword}
												onChange={(e) => setNewPassword(e.target.value)}
												className="max-w-md"
												required
												minLength={8}
											/>
											<p className="text-xs text-muted-foreground">
												Must be at least 8 characters long
											</p>
										</div>
										<div className="space-y-2">
											<Label htmlFor="confirm-password">Confirm New Password</Label>
											<Input
												id="confirm-password"
												type="password"
												value={confirmPassword}
												onChange={(e) => setConfirmPassword(e.target.value)}
												className="max-w-md"
												required
												minLength={8}
											/>
										</div>
										<Button type="submit" loading={isChangingPassword} className="mt-4">
											<KeyRound size={16} className="mr-2" />
											Change Password
										</Button>
									</form>
								</CardContent>
							</>
						)}

						{permissions.hasRuntimeFeature("apiKeys") && (
							<ApiKeysSection passwordAuthSupported={passwordAuthSupported} hasPassword={hasPassword} />
						)}

						<TwoFactorSection twoFactorEnabled={appContext.user?.twoFactorEnabled} />

						<PasskeysSection />
					</Card>
				</div>
			)}

			{activeScope === "organization" && (
				<div className="space-y-4">
					{showOrganizationDetails && <OrganizationDetailsSection />}
					{showOrganizationMembers && (
						<Card className="p-0 gap-0">
							<div className="border-b border-border/50 bg-card-header p-6">
								<CardTitle className="flex items-center gap-2">
									<Building2 className="size-5" />
									Members
								</CardTitle>
								<CardDescription className="mt-1.5">
									Manage organization members and roles
								</CardDescription>
							</div>
							<CardContent className="p-6">
								<OrgMembersSection initialMembers={initialMembers} />
							</CardContent>
						</Card>
					)}

					{showSsoSettings && (
						<Card className="p-0 gap-0">
							<div className="border-b border-border/50 bg-card-header p-6">
								<CardTitle className="flex items-center gap-2">
									<SettingsIcon className="size-5" />
									Single Sign-On
								</CardTitle>
								<CardDescription className="mt-1.5">Configure OIDC provider settings</CardDescription>
							</div>
							<CardContent className="p-6">
								<SsoSettingsSection
									initialSettings={initialSsoSettings}
									initialOrigin={initialOrigin}
								/>
							</CardContent>
						</Card>
					)}

					{showRecoveryKey && (
						<Card id="recovery-key" className="scroll-mt-20 p-0 gap-0">
							<RecoveryKeySection
								passwordAuthSupported={passwordAuthSupported}
								hasPassword={hasPassword}
							/>
						</Card>
					)}
				</div>
			)}
		</div>
	);
}
