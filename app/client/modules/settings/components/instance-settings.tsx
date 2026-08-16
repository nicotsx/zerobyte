import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { Users, Settings as SettingsIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	getPasswordLoginStatusOptions,
	getRegistrationStatusOptions,
	setPasswordLoginStatusMutation,
	setRegistrationStatusMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "~/client/components/ui/alert-dialog";
import { Card, CardContent, CardDescription, CardTitle } from "~/client/components/ui/card";
import { Label } from "~/client/components/ui/label";
import { Switch } from "~/client/components/ui/switch";
import { usePermissions } from "~/client/hooks/use-permissions";
import type { AppContext } from "~/context";
import { UserManagement } from "./user-management";

type Props = {
	appContext: AppContext;
};

export function InstanceSettings({ appContext }: Props) {
	const permissions = usePermissions();
	const showUserManagement = permissions.can("instanceUsers.manage");
	const showRegistrationSettings = permissions.can("registration.manage");
	const showPasswordLoginSettings = permissions.can("passwordLogin.manage");
	const showSystemSettings = showRegistrationSettings || showPasswordLoginSettings;

	return (
		<div className="space-y-6">
			{showUserManagement && <UserManagementSection currentUser={appContext.user} />}
			{showSystemSettings && (
				<SystemSettingsSection
					showPasswordLoginSettings={showPasswordLoginSettings}
					showRegistrationSettings={showRegistrationSettings}
				/>
			)}
		</div>
	);
}

function UserManagementSection({ currentUser }: { currentUser: { id: string } | undefined | null }) {
	return (
		<Card className="p-0 gap-0">
			<div className="border-b border-border/50 bg-card-header p-6">
				<CardTitle className="flex items-center gap-2">
					<Users className="size-5" />
					User Management
				</CardTitle>
				<CardDescription className="mt-1.5">Manage users, roles and permissions</CardDescription>
			</div>
			<UserManagement currentUser={currentUser} />
		</Card>
	);
}

type SystemSettingsSectionProps = {
	showPasswordLoginSettings: boolean;
	showRegistrationSettings: boolean;
};

function SystemSettingsSection({ showPasswordLoginSettings, showRegistrationSettings }: SystemSettingsSectionProps) {
	return (
		<Card className="p-0 gap-0">
			<div className="border-b border-border/50 bg-card-header p-6">
				<CardTitle className="flex items-center gap-2">
					<SettingsIcon className="size-5" />
					System Settings
				</CardTitle>
				<CardDescription className="mt-1.5">Manage system-wide settings</CardDescription>
			</div>
			<CardContent className="p-6 space-y-6">
				{showRegistrationSettings && <RegistrationSettingsSection />}
				{showPasswordLoginSettings && <PasswordLoginSettingsSection showDivider={showRegistrationSettings} />}
			</CardContent>
		</Card>
	);
}

function RegistrationSettingsSection() {
	const registrationStatus = useSuspenseQuery({
		...getRegistrationStatusOptions(),
	});

	const updateRegistrationStatusMutation = useMutation({
		...setRegistrationStatusMutation(),
		onSuccess: () => {
			toast.success("Registration settings updated");
		},
		onError: (error) => {
			toast.error("Failed to update registration settings", {
				description: error.message,
			});
		},
	});

	return (
		<div className="flex items-center justify-between">
			<div className="space-y-0.5">
				<Label htmlFor="enable-registrations" className="text-base">
					Enable new user registrations
				</Label>
				<p className="text-sm text-muted-foreground max-w-2xl">When enabled, new users can sign up</p>
			</div>
			<Switch
				id="enable-registrations"
				checked={registrationStatus.data.enabled}
				onCheckedChange={(checked) => updateRegistrationStatusMutation.mutate({ body: { enabled: checked } })}
				disabled={updateRegistrationStatusMutation.isPending}
			/>
		</div>
	);
}

function PasswordLoginSettingsSection({ showDivider }: { showDivider: boolean }) {
	const [showDisablePasswordLoginConfirm, setShowDisablePasswordLoginConfirm] = useState(false);
	const passwordLoginSectionClassName = showDivider
		? "flex items-center justify-between pt-4 border-t border-border/50"
		: "flex items-center justify-between";

	const passwordLoginStatus = useSuspenseQuery({
		...getPasswordLoginStatusOptions(),
	});

	const updatePasswordLoginStatusMutation = useMutation({
		...setPasswordLoginStatusMutation(),
		onSuccess: () => {
			toast.success("Login settings updated");
		},
		onError: (error) => {
			toast.error("Failed to update login settings", {
				description: error.message,
			});
		},
	});

	const updatePasswordLoginDisabled = (disabled: boolean) => {
		updatePasswordLoginStatusMutation.mutate({ body: { disabled } });
	};

	return (
		<>
			<div className={passwordLoginSectionClassName}>
				<div className="space-y-0.5">
					<Label htmlFor="enable-password-login" className="text-base">
						Enable password login
					</Label>
					<p className="text-sm text-muted-foreground max-w-2xl">
						When disabled, the username and password form is hidden on the login page. Users can still sign
						in via SSO or passkeys.
					</p>
				</div>
				<Switch
					id="enable-password-login"
					checked={!passwordLoginStatus.data.disabled}
					onCheckedChange={(checked) => {
						if (checked) {
							updatePasswordLoginDisabled(false);
							return;
						}

						setShowDisablePasswordLoginConfirm(true);
					}}
					disabled={updatePasswordLoginStatusMutation.isPending}
				/>
			</div>
			<AlertDialog open={showDisablePasswordLoginConfirm} onOpenChange={setShowDisablePasswordLoginConfirm}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Disable password login?</AlertDialogTitle>
						<AlertDialogDescription>
							If you do not have SSO or a passkey configured, disabling password login can lock you out of
							this instance. You can recover by running&nbsp;
							<code>docker exec -it zerobyte bun run cli enable-password-login</code> on the server.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								updatePasswordLoginDisabled(true);
							}}
						>
							Disable password login
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
