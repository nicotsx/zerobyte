import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/client/components/ui/tabs";
import type { AppContext } from "~/context";
import { UserManagement } from "~/client/modules/settings/components/user-management";

type Props = {
	appContext: AppContext;
};

export function AdminPage({ appContext }: Props) {
	const { tab } = useSearch({ from: "/(dashboard)/admin/" });
	const activeTab = tab || "users";
	const navigate = useNavigate();
	const [showDisablePasswordLoginConfirm, setShowDisablePasswordLoginConfirm] = useState(false);

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

	const onTabChange = (value: string) => {
		void navigate({ to: ".", search: () => ({ tab: value }) });
	};

	const updatePasswordLoginDisabled = (disabled: boolean) => {
		updatePasswordLoginStatusMutation.mutate({ body: { disabled } });
	};

	return (
		<div className="space-y-6">
			<Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
				<TabsList>
					<TabsTrigger value="users">Users</TabsTrigger>
					<TabsTrigger value="system">System</TabsTrigger>
				</TabsList>

				<div className="mt-2">
					<TabsContent value="users" className="mt-0">
						<Card className="p-0 gap-0">
							<div className="border-b border-border/50 bg-card-header p-6">
								<CardTitle className="flex items-center gap-2">
									<Users className="size-5" />
									User Management
								</CardTitle>
								<CardDescription className="mt-1.5">
									Manage users, roles and permissions
								</CardDescription>
							</div>
							<UserManagement currentUser={appContext.user} />
						</Card>
					</TabsContent>

					<TabsContent value="system" className="mt-0">
						<Card className="p-0 gap-0">
							<div className="border-b border-border/50 bg-card-header p-6">
								<CardTitle className="flex items-center gap-2">
									<SettingsIcon className="size-5" />
									System Settings
								</CardTitle>
								<CardDescription className="mt-1.5">Manage system-wide settings</CardDescription>
							</div>
							<CardContent className="p-6 space-y-6">
								<div className="flex items-center justify-between">
									<div className="space-y-0.5">
										<Label htmlFor="enable-registrations" className="text-base">
											Enable new user registrations
										</Label>
										<p className="text-sm text-muted-foreground max-w-2xl">
											When enabled, new users can sign up
										</p>
									</div>
									<Switch
										id="enable-registrations"
										checked={registrationStatus.data.enabled}
										onCheckedChange={(checked) =>
											updateRegistrationStatusMutation.mutate({ body: { enabled: checked } })
										}
										disabled={updateRegistrationStatusMutation.isPending}
									/>
								</div>
								<div className="flex items-center justify-between pt-4 border-t border-border/50">
									<div className="space-y-0.5">
										<Label htmlFor="enable-password-login" className="text-base">
											Enable password login
										</Label>
										<p className="text-sm text-muted-foreground max-w-2xl">
											When disabled, the username and password form is hidden on the login page.
											Users can still sign in via SSO or passkeys.
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
							</CardContent>
						</Card>
					</TabsContent>
				</div>
			</Tabs>
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
		</div>
	);
}
