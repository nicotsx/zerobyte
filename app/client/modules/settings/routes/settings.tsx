import { useMutation } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
	AlertTriangle,
	Building2,
	Download,
	Fingerprint,
	KeyRound,
	Settings as SettingsIcon,
	User,
	X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { downloadResticPasswordMutation, exportConfigMutation } from "~/client/api-client/@tanstack/react-query.gen";
import type {
	GetOrgMembersResponse,
	GetSsoSettingsResponse,
	GetUserSsoInvitationsResponse,
} from "~/client/api-client/types.gen";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "~/client/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "~/client/components/ui/alert";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "~/client/components/ui/dialog";
import { Input } from "~/client/components/ui/input";
import { Label } from "~/client/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/client/components/ui/tabs";
import { useRootLoaderData } from "~/client/hooks/use-root-loader-data";
import { authClient } from "~/client/lib/auth-client";
import { downloadFile } from "~/client/lib/download";
import {
	DATE_FORMATS,
	type DateFormatPreference,
	TIME_FORMATS,
	type TimeFormatPreference,
	useTimeFormat,
} from "~/client/lib/datetime";
import { logger } from "~/client/lib/logger";
import { parseError } from "~/client/lib/errors";
import { cn } from "~/client/lib/utils";
import { type AppContext } from "~/context";
import { TwoFactorSection } from "../components/two-factor-section";
import { PasskeysSection } from "../components/passkeys-section";
import { ApiKeysSection } from "../components/api-keys-section";
import { SsoSettingsSection } from "~/client/modules/sso/components/sso-settings-section";
import { OrgMembersSection } from "../components/org-members-section";
import { PendingInvitationsSection } from "../components/pending-invitations-section";
import { useOrganizationContext } from "~/client/hooks/use-org-context";
import { usePermissions } from "~/client/hooks/use-permissions";

const RECOVERY_KEY_PASSWORD_REQUIRED_MESSAGE =
	"Downloading the recovery key requires a local password. Ask an operator to run `docker exec -it zerobyte bun run cli reset-password` for your user, then sign in with that password and try again.";

type Props = {
	appContext: AppContext;
	initialUserInvitations: GetUserSsoInvitationsResponse;
	initialMembers?: GetOrgMembersResponse;
	initialSsoSettings?: GetSsoSettingsResponse;
	initialOrigin?: string;
};

export function SettingsPage({
	appContext,
	initialUserInvitations,
	initialMembers,
	initialSsoSettings,
	initialOrigin,
}: Props) {
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
	const [downloadPassword, setDownloadPassword] = useState("");
	const [downloadBlockedMessage, setDownloadBlockedMessage] = useState<string | null>(null);
	const [isChangingPassword, setIsChangingPassword] = useState(false);
	const { dateFormat, timeFormat } = useRootLoaderData();
	const permissions = usePermissions();

	const { tab } = useSearch({ from: "/(dashboard)/settings/" });

	const navigate = useNavigate();
	const { activeOrganization } = useOrganizationContext();
	const showOrganizationSettings = permissions.can("organizationSettings.view");
	const activeTab = tab === "organization" && !showOrganizationSettings ? "account" : tab || "account";
	const { formatDateTime } = useTimeFormat();
	const passwordAuthSupported = appContext.passwordAuthSupported;
	const hasPassword = appContext.user?.hasPassword === true;
	const canDownloadRecoveryKey = !passwordAuthSupported || hasPassword;

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

	const downloadResticPassword = useMutation({
		...downloadResticPasswordMutation(),
		onSuccess: (data) => {
			downloadFile({
				content: data,
				contentType: "text/plain",
				fileName: "restic.pass",
			});

			toast.success("Restic password file downloaded successfully");
			setDownloadDialogOpen(false);
			setDownloadPassword("");
			setDownloadBlockedMessage(null);
		},
		onError: (error) => {
			const message = parseError(error)?.message;
			setDownloadBlockedMessage(message?.includes("local password") ? message : null);
			toast.error("Failed to download Restic password", {
				description: message,
			});
		},
	});

	const exportConfig = useMutation({
		...exportConfigMutation(),
		onSuccess: (data) => {
			downloadFile({
				content: data,
				contentType: "text/plain",
				fileName: "zerobyte-config.zbex",
			});

			toast.success("Encrypted configuration exported successfully");
		},
		onError: (error) => {
			toast.error("Failed to export configuration", {
				description: error.message,
			});
		},
	});

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

	const handleDownloadResticPassword = (e: React.SubmitEvent) => {
		e.preventDefault();

		if (passwordAuthSupported && !downloadPassword) {
			toast.error("Password is required");
			return;
		}

		setDownloadBlockedMessage(null);
		downloadResticPassword.mutate({
			body: {
				password: passwordAuthSupported ? downloadPassword : "",
			},
		});
	};

	const handleDateTimeFormatChange = async (
		nextDateFormat: DateFormatPreference,
		nextTimeFormat: TimeFormatPreference,
	) => {
		await authClient.updateUser({
			dateFormat: nextDateFormat,
			timeFormat: nextTimeFormat,
			fetchOptions: {
				onError: ({ error }) => {
					toast.error("Failed to update date and time format", {
						description: error.message,
					});
				},
				onSuccess: () => {
					window.location.reload();
				},
			},
		});
	};

	const handleDateFormatChange = async (nextDateFormat: DateFormatPreference) => {
		if (nextDateFormat === dateFormat) {
			return;
		}

		await handleDateTimeFormatChange(nextDateFormat, timeFormat);
	};

	const handleTimeFormatChange = async (nextTimeFormat: TimeFormatPreference) => {
		if (nextTimeFormat === timeFormat) {
			return;
		}

		await handleDateTimeFormatChange(dateFormat, nextTimeFormat);
	};

	const onTabChange = (value: string) => {
		void navigate({ to: ".", search: () => ({ tab: value }) });
	};

	return (
		<div className="space-y-6">
			<Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
				<TabsList>
					<TabsTrigger value="account">Account</TabsTrigger>
					{showOrganizationSettings && <TabsTrigger value="organization">Organization</TabsTrigger>}
				</TabsList>

				<div className="mt-2">
					<TabsContent value="account" className="mt-0">
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
									<Input id="email" type="email" value={appContext.user?.email} disabled className="max-w-md" />
								</div>
							</CardContent>

							{permissions.hasRuntimeFeature("ssoManagement") && (
								<PendingInvitationsSection
									initialInvitations={initialUserInvitations}
									userEmail={appContext.user?.email}
								/>
							)}

							<div className="border-t border-border/50 bg-card-header p-6">
								<CardTitle className="flex items-center gap-2">
									<SettingsIcon className="size-5" />
									Date and Time Format
								</CardTitle>
								<CardDescription className="mt-1.5">
									Choose how dates and times are shown throughout the app
								</CardDescription>
							</div>
							<CardContent className="p-6">
								<div className="space-y-4 max-w-2xl">
									<div className="grid gap-4 md:grid-cols-2">
										<div className="space-y-2">
											<Label htmlFor="date-format">Date format</Label>
											<Select
												value={dateFormat}
												onValueChange={(value) => void handleDateFormatChange(value as DateFormatPreference)}
											>
												<SelectTrigger id="date-format">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{DATE_FORMATS.map((value) => (
														<SelectItem key={value} value={value}>
															{value}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
										<div className="space-y-2">
											<Label htmlFor="time-format">Time format</Label>
											<Select
												value={timeFormat}
												onValueChange={(value) => void handleTimeFormatChange(value as TimeFormatPreference)}
											>
												<SelectTrigger id="time-format">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{TIME_FORMATS.map((value) => (
														<SelectItem key={value} value={value}>
															{value}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
									</div>
									<p className="text-sm text-muted-foreground">Preview: {formatDateTime(new Date())}</p>
								</div>
							</CardContent>

							<div
								className={cn("border-t border-border/50 bg-card-header p-6", {
									hidden: !hasPassword,
								})}
							>
								<CardTitle className="flex items-center gap-2">
									<KeyRound className="size-5" />
									Change Password
								</CardTitle>
								<CardDescription className="mt-1.5">Update your password to keep your account secure</CardDescription>
							</div>
							<CardContent className={cn("p-6", { hidden: !hasPassword })}>
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
										<p className="text-xs text-muted-foreground">Must be at least 8 characters long</p>
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

							<div className="border-t border-border/50 bg-card-header p-6">
								<CardTitle className="flex items-center gap-2">
									<Download className="size-5" />
									Backup Recovery Key
								</CardTitle>
								<CardDescription className="mt-1.5">Download your recovery key for Restic backups</CardDescription>
							</div>
							<CardContent className="p-6 space-y-4">
								<p className="text-sm text-muted-foreground max-w-2xl">
									This file contains the encryption password used by Restic to secure your backups. Store it in a safe
									place (like a password manager or encrypted storage). If you lose access to this server, you'll need
									this file to recover your backup data.
								</p>

								<Dialog open={downloadDialogOpen} onOpenChange={setDownloadDialogOpen}>
									<DialogTrigger asChild>
										<Button variant="outline">
											<Download size={16} className="mr-2" />
											Download recovery key
										</Button>
									</DialogTrigger>
									<DialogContent>
										<form onSubmit={handleDownloadResticPassword}>
											<DialogHeader>
												<DialogTitle>Download Recovery Key</DialogTitle>
												<DialogDescription>
													{!passwordAuthSupported
														? "Download the recovery key file and store it somewhere safe."
														: !hasPassword
															? "A local password is required before this recovery key can be downloaded."
															: "For security reasons, please enter your account password to download the recovery key file."}
												</DialogDescription>
											</DialogHeader>
											<div className="space-y-4 py-4">
												<Alert
													variant="warning"
													className={cn({
														hidden:
															!passwordAuthSupported ||
															(hasPassword && !downloadBlockedMessage),
													})}
												>
													<AlertTriangle className="size-5" />
													<AlertTitle>Local password required</AlertTitle>
												<AlertDescription>{downloadBlockedMessage ?? RECOVERY_KEY_PASSWORD_REQUIRED_MESSAGE}</AlertDescription>
												</Alert>
												<div
													className={cn("space-y-2", {
														hidden: !passwordAuthSupported || !hasPassword,
													})}
												>
													<Label htmlFor="download-password">Your Password</Label>
													<Input
														id="download-password"
														type="password"
														value={downloadPassword}
														onChange={(e) => setDownloadPassword(e.target.value)}
														placeholder="Enter your password"
														required={passwordAuthSupported && hasPassword}
													/>
												</div>
											</div>
											<DialogFooter>
												<Button
													type="button"
													variant="outline"
													onClick={() => {
														setDownloadDialogOpen(false);
														setDownloadPassword("");
													}}
												>
													<X className="h-4 w-4 mr-2" />
													Cancel
												</Button>
												<Button
													type="submit"
													loading={downloadResticPassword.isPending}
													className={cn({ hidden: !canDownloadRecoveryKey })}
												>
													<Download className="h-4 w-4 mr-2" />
													Download
												</Button>
											</DialogFooter>
										</form>
									</DialogContent>
								</Dialog>
							</CardContent>

							{permissions.hasRuntimeFeature("apiKeys") && (
								<ApiKeysSection
									passwordAuthSupported={passwordAuthSupported}
									hasPassword={hasPassword}
								/>
							)}

							<TwoFactorSection twoFactorEnabled={appContext.user?.twoFactorEnabled} />

							<PasskeysSection />
						</Card>
					</TabsContent>

					{showOrganizationSettings && (
						<TabsContent value="organization" className="mt-0 space-y-4">
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
									<p className="text-sm text-muted-foreground max-w-2xl pt-2">
										Download an encrypted export of your organization configuration. You can import it during onboarding
										on a new Zerobyte instance with the source instance APP_SECRET.
									</p>
									<Button variant="outline" onClick={() => exportConfig.mutate({})} loading={exportConfig.isPending}>
										<Download className="h-4 w-4 mr-2" />
										Export encrypted config
									</Button>
								</CardContent>
							</Card>

							<Card className="p-0 gap-0">
								<div className="border-b border-border/50 bg-card-header p-6">
									<CardTitle className="flex items-center gap-2">
										<Building2 className="size-5" />
										Members
									</CardTitle>
									<CardDescription className="mt-1.5">Manage organization members and roles</CardDescription>
								</div>
								<CardContent className="p-6">
									<OrgMembersSection initialMembers={initialMembers} />
								</CardContent>
							</Card>

							<Card className="p-0 gap-0">
								<div className="border-b border-border/50 bg-card-header p-6">
									<CardTitle className="flex items-center gap-2">
										<SettingsIcon className="size-5" />
										Single Sign-On
									</CardTitle>
									<CardDescription className="mt-1.5">Configure OIDC provider settings</CardDescription>
								</div>
								<CardContent className="p-6">
									<SsoSettingsSection initialSettings={initialSsoSettings} initialOrigin={initialOrigin} />
								</CardContent>
							</Card>
						</TabsContent>
					)}
				</div>
			</Tabs>
		</div>
	);
}
