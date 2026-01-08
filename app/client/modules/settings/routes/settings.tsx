import { useMutation } from "@tanstack/react-query";
import { Download, KeyRound, User, X, Shield, Copy, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { QRCodeCanvas } from "qrcode.react";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "~/client/components/ui/card";
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
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "~/client/components/ui/input-otp";
import { Label } from "~/client/components/ui/label";
import { appContext } from "~/context";
import type { Route } from "./+types/settings";
import { downloadResticPasswordMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { authClient } from "~/client/lib/auth-client";

export const handle = {
	breadcrumb: () => [{ label: "Settings" }],
};

export function meta(_: Route.MetaArgs) {
	return [
		{ title: "Zerobyte - Settings" },
		{
			name: "description",
			content: "Manage your account settings and preferences.",
		},
	];
}

export async function clientLoader({ context }: Route.LoaderArgs) {
	const ctx = context.get(appContext);
	return ctx;
}

export default function Settings({ loaderData }: Route.ComponentProps) {
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
	const [downloadPassword, setDownloadPassword] = useState("");
	const [isChangingPassword, setIsChangingPassword] = useState(false);

	// 2FA states
	const [setup2FADialogOpen, setSetup2FADialogOpen] = useState(false);
	const [disable2FADialogOpen, setDisable2FADialogOpen] = useState(false);
	const [backupCodesDialogOpen, setBackupCodesDialogOpen] = useState(false);
	const [setup2FAPassword, setSetup2FAPassword] = useState("");
	const [disable2FAPassword, setDisable2FAPassword] = useState("");
	const [totpUri, setTotpUri] = useState<string | null>(null);
	const [verificationCode, setVerificationCode] = useState("");
	const [backupCodes, setBackupCodes] = useState<string[]>([]);
	const [setupStep, setSetupStep] = useState<"password" | "qr" | "verify">("password");
	const [isEnabling2FA, setIsEnabling2FA] = useState(false);
	const [isVerifying2FA, setIsVerifying2FA] = useState(false);
	const [isDisabling2FA, setIsDisabling2FA] = useState(false);
	const [isGeneratingBackupCodes, setIsGeneratingBackupCodes] = useState(false);
	const [backupCodesPassword, setBackupCodesPassword] = useState("");

	const navigate = useNavigate();

	const handleLogout = async () => {
		await authClient.signOut({
			fetchOptions: {
				onSuccess: () => {
					void navigate("/login", { replace: true });
				},
				onError: ({ error }) => {
					console.error(error);
					toast.error("Logout failed", { description: error.message });
				},
			},
		});
	};

	const downloadResticPassword = useMutation({
		...downloadResticPasswordMutation(),
		onSuccess: (data) => {
			const blob = new Blob([data], { type: "text/plain" });
			const url = window.URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = "restic.pass";
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			window.URL.revokeObjectURL(url);

			toast.success("Restic password file downloaded successfully");
			setDownloadDialogOpen(false);
			setDownloadPassword("");
		},
		onError: (error) => {
			toast.error("Failed to download Restic password", { description: error.message });
		},
	});

	const handleChangePassword = async (e: React.FormEvent) => {
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
				onError: (error) => {
					toast.error("Failed to change password", { description: error.error.message });
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

	const handleDownloadResticPassword = (e: React.FormEvent) => {
		e.preventDefault();

		if (!downloadPassword) {
			toast.error("Password is required");
			return;
		}

		downloadResticPassword.mutate({
			body: {
				password: downloadPassword,
			},
		});
	};

	// 2FA handlers
	const handleEnable2FA = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!setup2FAPassword) {
			toast.error("Password is required");
			return;
		}

		setIsEnabling2FA(true);

		const { data, error } = await authClient.twoFactor.enable({
			password: setup2FAPassword,
			issuer: "Zerobyte",
		});

		setIsEnabling2FA(false);

		if (error) {
			console.error(error);
			toast.error("Failed to enable 2FA", { description: error.message });
			return;
		}

		if (data?.totpURI && data?.backupCodes) {
			setTotpUri(data.totpURI);
			setBackupCodes(data.backupCodes);
			setSetupStep("qr");
		}
	};

	const handleVerify2FA = async () => {
		if (verificationCode.length !== 6) {
			toast.error("Please enter a 6-digit code");
			return;
		}

		setIsVerifying2FA(true);

		const { data, error } = await authClient.twoFactor.verifyTotp({
			code: verificationCode,
		});

		setIsVerifying2FA(false);

		if (error) {
			console.error(error);
			toast.error("Verification failed", { description: error.message });
			setVerificationCode("");
			return;
		}

		if (data) {
			toast.success("Two-factor authentication enabled successfully");
			// Refresh the session to get updated user data
			await authClient.getSession();
			// Reset and close dialog
			handleClose2FASetup();
			// Reload the page to update the UI
			window.location.reload();
		}
	};

	const handleDisable2FA = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!disable2FAPassword) {
			toast.error("Password is required");
			return;
		}

		setIsDisabling2FA(true);

		const { data, error } = await authClient.twoFactor.disable({
			password: disable2FAPassword,
		});

		setIsDisabling2FA(false);

		if (error) {
			console.error(error);
			toast.error("Failed to disable 2FA", { description: error.message });
			return;
		}

		if (data) {
			toast.success("Two-factor authentication disabled successfully");
			setDisable2FADialogOpen(false);
			setDisable2FAPassword("");
			// Refresh the session to get updated user data
			await authClient.getSession();
			// Reload the page to update the UI
			window.location.reload();
		}
	};

	const handleGenerateBackupCodes = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!backupCodesPassword) {
			toast.error("Password is required");
			return;
		}

		setIsGeneratingBackupCodes(true);

		const { data, error } = await authClient.twoFactor.generateBackupCodes({
			password: backupCodesPassword,
		});

		setIsGeneratingBackupCodes(false);

		if (error) {
			console.error(error);
			toast.error("Failed to generate backup codes", { description: error.message });
			return;
		}

		if (data?.backupCodes) {
			setBackupCodes(data.backupCodes);
			setBackupCodesPassword("");
			toast.success("New backup codes generated successfully");
		}
	};

	const handleClose2FASetup = () => {
		setSetup2FADialogOpen(false);
		setSetup2FAPassword("");
		setTotpUri(null);
		setVerificationCode("");
		setBackupCodes([]);
		setSetupStep("password");
	};

	const copyToClipboard = (text: string) => {
		navigator.clipboard.writeText(text);
		toast.success("Copied to clipboard");
	};

	const copyAllBackupCodes = () => {
		const text = backupCodes.join("\n");
		navigator.clipboard.writeText(text);
		toast.success("All backup codes copied to clipboard");
	};

	return (
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
					<Label>Username</Label>
					<Input value={loaderData.user?.username || ""} disabled className="max-w-md" />
				</div>
			</CardContent>

			<div className="border-t border-border/50 bg-card-header p-6">
				<CardTitle className="flex items-center gap-2">
					<KeyRound className="size-5" />
					Change Password
				</CardTitle>
				<CardDescription className="mt-1.5">Update your password to keep your account secure</CardDescription>
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
						<KeyRound className="h-4 w-4 mr-2" />
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
					This file contains the encryption password used by Restic to secure your backups. Store it in a safe place
					(like a password manager or encrypted storage). If you lose access to this server, you'll need this file to
					recover your backup data.
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
									For security reasons, please enter your account password to download the recovery key file.
								</DialogDescription>
							</DialogHeader>
							<div className="space-y-4 py-4">
								<div className="space-y-2">
									<Label htmlFor="download-password">Your Password</Label>
									<Input
										id="download-password"
										type="password"
										value={downloadPassword}
										onChange={(e) => setDownloadPassword(e.target.value)}
										placeholder="Enter your password"
										required
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
								<Button type="submit" loading={downloadResticPassword.isPending}>
									<Download className="h-4 w-4 mr-2" />
									Download
								</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>
			</CardContent>

			<div className="border-t border-border/50 bg-card-header p-6">
				<CardTitle className="flex items-center gap-2">
					<Shield className="size-5" />
					Two-Factor Authentication
				</CardTitle>
				<CardDescription className="mt-1.5">Add an extra layer of security to your account</CardDescription>
			</div>
			<CardContent className="p-6 space-y-4">
				<div className="flex items-center justify-between">
					<div className="space-y-1">
						<p className="text-sm font-medium">
							Status:&nbsp;
							{loaderData.user?.twoFactorEnabled ? (
								<span className="text-green-600 dark:text-green-400">Enabled</span>
							) : (
								<span className="text-muted-foreground">Disabled</span>
							)}
						</p>
						<p className="text-xs text-muted-foreground max-w-xl">
							Two-factor authentication adds an extra layer of security by requiring a code from your authenticator app
							in addition to your password.
						</p>
					</div>
					<div className="flex gap-2">
						{!loaderData.user?.twoFactorEnabled ? (
							<Button onClick={() => setSetup2FADialogOpen(true)}>Enable 2FA</Button>
						) : (
							<>
								<Button variant="outline" onClick={() => setBackupCodesDialogOpen(true)}>
									Backup Codes
								</Button>
								<Button variant="destructive" onClick={() => setDisable2FADialogOpen(true)}>
									Disable 2FA
								</Button>
							</>
						)}
					</div>
				</div>

				<Dialog open={setup2FADialogOpen} onOpenChange={handleClose2FASetup}>
					<DialogContent className="max-w-md">
						{setupStep === "password" && (
							<form onSubmit={handleEnable2FA}>
								<DialogHeader>
									<DialogTitle>Enable Two-Factor Authentication</DialogTitle>
									<DialogDescription>
										Enter your password to generate a QR code for your authenticator app
									</DialogDescription>
								</DialogHeader>
								<div className="space-y-4 py-4">
									<div className="space-y-2">
										<Label htmlFor="setup-password">Your Password</Label>
										<Input
											id="setup-password"
											type="password"
											value={setup2FAPassword}
											onChange={(e) => setSetup2FAPassword(e.target.value)}
											placeholder="Enter your password"
											required
											autoFocus
										/>
									</div>
								</div>
								<DialogFooter>
									<Button type="button" variant="outline" onClick={handleClose2FASetup}>
										Cancel
									</Button>
									<Button type="submit" loading={isEnabling2FA}>
										Continue
									</Button>
								</DialogFooter>
							</form>
						)}

						{setupStep === "qr" && totpUri && (
							<>
								<DialogHeader>
									<DialogTitle>Scan QR Code</DialogTitle>
									<DialogDescription>
										Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
									</DialogDescription>
								</DialogHeader>
								<div className="space-y-4 py-4">
									<div className="flex justify-center p-4 bg-white rounded-lg">
										<QRCodeCanvas value={totpUri} size={200} />
									</div>
									<div className="space-y-2">
										<Label className="text-xs">Manual Entry Code</Label>
										<div className="flex items-center gap-2">
											<Input
												value={totpUri.split("secret=")[1]?.split("&")[0] || ""}
												readOnly
												className="text-xs font-mono"
											/>
											<Button
												type="button"
												variant="outline"
												size="sm"
												onClick={() => copyToClipboard(totpUri.split("secret=")[1]?.split("&")[0] || "")}
											>
												<Copy className="h-4 w-4" />
											</Button>
										</div>
									</div>
									{backupCodes.length > 0 && (
										<div className="space-y-2">
											<Label className="text-xs">Backup Codes (Save these securely)</Label>
											<div className="p-3 bg-muted rounded-md space-y-1 max-h-32 overflow-y-auto">
												{backupCodes.map((code) => (
													<div key={code} className="text-xs font-mono flex items-center justify-between">
														<span>{code}</span>
														<Button
															type="button"
															variant="ghost"
															size="sm"
															onClick={() => copyToClipboard(code)}
															className="h-6 w-6 p-0"
														>
															<Copy className="h-3 w-3" />
														</Button>
													</div>
												))}
											</div>
											<Button type="button" variant="outline" size="sm" onClick={copyAllBackupCodes} className="w-full">
												<Copy className="h-4 w-4 mr-2" />
												Copy All Codes
											</Button>
										</div>
									)}
								</div>
								<DialogFooter>
									<Button type="button" onClick={() => setSetupStep("verify")}>
										I've Scanned It
									</Button>
								</DialogFooter>
							</>
						)}

						{setupStep === "verify" && (
							<>
								<DialogHeader>
									<DialogTitle>Verify Setup</DialogTitle>
									<DialogDescription>
										Enter the 6-digit code from your authenticator app to complete setup
									</DialogDescription>
								</DialogHeader>
								<div className="space-y-4 py-4">
									<div className="space-y-2">
										<Label>Verification Code</Label>
										<div className="flex justify-center">
											<InputOTP
												maxLength={6}
												value={verificationCode}
												onChange={setVerificationCode}
												onComplete={handleVerify2FA}
												disabled={isVerifying2FA}
											>
												<InputOTPGroup>
													<InputOTPSlot index={0} />
													<InputOTPSlot index={1} />
													<InputOTPSlot index={2} />
												</InputOTPGroup>
												<InputOTPSeparator />
												<InputOTPGroup>
													<InputOTPSlot index={3} />
													<InputOTPSlot index={4} />
													<InputOTPSlot index={5} />
												</InputOTPGroup>
											</InputOTP>
										</div>
									</div>
								</div>
								<DialogFooter>
									<Button type="button" variant="outline" onClick={() => setSetupStep("qr")}>
										Back
									</Button>
									<Button
										type="button"
										onClick={handleVerify2FA}
										loading={isVerifying2FA}
										disabled={verificationCode.length !== 6}
									>
										Verify & enable
									</Button>
								</DialogFooter>
							</>
						)}
					</DialogContent>
				</Dialog>

				<Dialog open={disable2FADialogOpen} onOpenChange={setDisable2FADialogOpen}>
					<DialogContent>
						<form onSubmit={handleDisable2FA}>
							<DialogHeader>
								<DialogTitle>Disable Two-Factor Authentication</DialogTitle>
								<DialogDescription>
									Are you sure you want to disable 2FA? Your account will be less secure. Enter your password to
									confirm.
								</DialogDescription>
							</DialogHeader>
							<div className="space-y-4 py-4">
								<div className="space-y-2">
									<Label htmlFor="disable-password">Your Password</Label>
									<Input
										id="disable-password"
										type="password"
										value={disable2FAPassword}
										onChange={(e) => setDisable2FAPassword(e.target.value)}
										placeholder="Enter your password"
										required
										autoFocus
									/>
								</div>
							</div>
							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									onClick={() => {
										setDisable2FADialogOpen(false);
										setDisable2FAPassword("");
									}}
								>
									Cancel
								</Button>
								<Button type="submit" variant="destructive" loading={isDisabling2FA}>
									Disable 2FA
								</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>

				<Dialog open={backupCodesDialogOpen} onOpenChange={setBackupCodesDialogOpen}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Backup Codes</DialogTitle>
							<DialogDescription>
								Use these codes to access your account if you lose access to your authenticator app. Each code can only
								be used once.
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-4 py-4">
							{backupCodes.length > 0 ? (
								<>
									<div className="p-3 bg-muted rounded-md space-y-1 max-h-48 overflow-y-auto">
										{backupCodes.map((code) => (
											<div key={code} className="text-sm font-mono flex items-center justify-between">
												<span>{code}</span>
												<Button
													type="button"
													variant="ghost"
													size="sm"
													onClick={() => copyToClipboard(code)}
													className="h-8 w-8 p-0"
												>
													<Copy className="h-4 w-4" />
												</Button>
											</div>
										))}
									</div>
									<Button type="button" variant="outline" onClick={copyAllBackupCodes} className="w-full">
										<Copy className="h-4 w-4 mr-2" />
										Copy All Codes
									</Button>
								</>
							) : (
								<form onSubmit={handleGenerateBackupCodes} className="space-y-4">
									<div className="space-y-2">
										<Label htmlFor="backup-codes-password">Your Password</Label>
										<Input
											id="backup-codes-password"
											type="password"
											value={backupCodesPassword}
											onChange={(e) => setBackupCodesPassword(e.target.value)}
											placeholder="Enter your password"
											required
											autoFocus
										/>
									</div>
									<Button type="submit" loading={isGeneratingBackupCodes} className="w-full">
										<RefreshCw className="h-4 w-4 mr-2" />
										Generate New Backup Codes
									</Button>
								</form>
							)}
						</div>
						<DialogFooter>
							<Button
								type="button"
								onClick={() => {
									setBackupCodesDialogOpen(false);
									setBackupCodes([]);
									setBackupCodesPassword("");
								}}
							>
								Close
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</CardContent>
		</Card>
	);
}
