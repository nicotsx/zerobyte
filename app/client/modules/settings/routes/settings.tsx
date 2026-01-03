import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, Download, KeyRound, Shield, User, X } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Badge } from "~/client/components/ui/badge";
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
import { Label } from "~/client/components/ui/label";
import { appContext } from "~/context";
import type { Route } from "./+types/settings";
import {
	changePasswordMutation,
	disable2FaMutation,
	downloadResticPasswordMutation,
	enable2FaMutation,
	getTwoFactorStatusOptions,
	logoutMutation,
	setup2FaMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import type { Disable2FaResponse, Enable2FaResponse, Setup2FaResponse } from "~/client/api-client/types.gen";
import { copyToClipboard } from "~/utils/clipboard";

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
	const [enable2faDialogOpen, setEnable2faDialogOpen] = useState(false);
	const [enable2faStep, setEnable2faStep] = useState<"setup" | "verify">("setup");
	const [enable2faPassword, setEnable2faPassword] = useState("");
	const [enable2faSecret, setEnable2faSecret] = useState("");
	const [enable2faUri, setEnable2faUri] = useState("");
	const [enable2faCode, setEnable2faCode] = useState("");
	const [disable2faDialogOpen, setDisable2faDialogOpen] = useState(false);
	const [disable2faPassword, setDisable2faPassword] = useState("");
	const [disable2faCode, setDisable2faCode] = useState("");
	const navigate = useNavigate();

	const twoFactorStatus = useQuery({
		...getTwoFactorStatusOptions(),
	});

	const logout = useMutation({
		...logoutMutation(),
		onSuccess: () => {
			navigate("/login", { replace: true });
		},
	});

	const changePassword = useMutation({
		...changePasswordMutation(),
		onSuccess: (data) => {
			if (data.success) {
				toast.success("Password changed successfully. You will be logged out.");
				setTimeout(() => {
					logout.mutate({});
				}, 1500);
			} else {
				toast.error("Failed to change password", { description: data.message });
			}
		},
		onError: (error) => {
			toast.error("Failed to change password", { description: error.message });
		},
	});

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

	const setup2fa = useMutation({
		...setup2FaMutation(),
		onSuccess: (data: Setup2FaResponse) => {
			if (data.success && data.uri && data.secret) {
				setEnable2faUri(data.uri);
				setEnable2faSecret(data.secret);
				setEnable2faStep("verify");
			} else {
				toast.error("Failed to setup 2FA", { description: data.message });
				setEnable2faDialogOpen(false);
				resetEnable2faDialog();
			}
		},
		onError: (error) => {
			toast.error("Failed to setup 2FA", { description: error.message });
			setEnable2faDialogOpen(false);
			resetEnable2faDialog();
		},
	});

	const enable2fa = useMutation({
		...enable2FaMutation(),
		onSuccess: (data: Enable2FaResponse) => {
			if (data.success) {
				toast.success("2FA enabled successfully. Please log in again.");
				setEnable2faDialogOpen(false);
				resetEnable2faDialog();
				setTimeout(() => {
					navigate("/login", { replace: true });
				}, 1500);
			} else {
				toast.error("Failed to enable 2FA", { description: data.message });
			}
		},
		onError: (error) => {
			toast.error("Failed to enable 2FA", { description: error.message });
		},
	});

	const disable2fa = useMutation({
		...disable2FaMutation(),
		onSuccess: (data: Disable2FaResponse) => {
			if (data.success) {
				toast.success("2FA disabled successfully. Please log in again.");
				setDisable2faDialogOpen(false);
				resetDisable2faDialog();
				setTimeout(() => {
					navigate("/login", { replace: true });
				}, 1500);
			} else {
				toast.error("Failed to disable 2FA", { description: data.message });
			}
		},
		onError: (error) => {
			toast.error("Failed to disable 2FA", { description: error.message });
		},
	});

	const resetEnable2faDialog = () => {
		setEnable2faStep("setup");
		setEnable2faPassword("");
		setEnable2faSecret("");
		setEnable2faUri("");
		setEnable2faCode("");
	};

	const resetDisable2faDialog = () => {
		setDisable2faPassword("");
		setDisable2faCode("");
	};

	const handleChangePassword = (e: React.FormEvent) => {
		e.preventDefault();

		if (newPassword !== confirmPassword) {
			toast.error("Passwords do not match");
			return;
		}

		if (newPassword.length < 8) {
			toast.error("Password must be at least 8 characters long");
			return;
		}

		changePassword.mutate({
			body: {
				currentPassword,
				newPassword,
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

	const handleStartEnable2fa = () => {
		setup2fa.mutate({});
	};

	const handleConfirmEnable2fa = (e: React.FormEvent) => {
		e.preventDefault();

		if (!enable2faPassword) {
			toast.error("Password is required");
			return;
		}

		if (!enable2faCode || enable2faCode.length !== 6) {
			toast.error("Please enter a valid 6-digit code");
			return;
		}

		enable2fa.mutate({
			body: {
				password: enable2faPassword,
				secret: enable2faSecret,
				code: enable2faCode,
			},
		});
	};

	const handleDisable2fa = (e: React.FormEvent) => {
		e.preventDefault();

		if (!disable2faPassword) {
			toast.error("Password is required");
			return;
		}

		if (!disable2faCode || disable2faCode.length !== 6) {
			toast.error("Please enter a valid 6-digit code");
			return;
		}

		disable2fa.mutate({
			body: {
				password: disable2faPassword,
				code: disable2faCode,
			},
		});
	};

	const handleCopySecret = () => {
		copyToClipboard(enable2faSecret);
		toast.success("Secret key copied to clipboard");
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
					<Button type="submit" loading={changePassword.isPending} className="mt-4">
						<KeyRound className="h-4 w-4 mr-2" />
						Change Password
					</Button>
				</form>
			</CardContent>

			{/* Two-Factor Authentication Section */}
			<div className="border-t border-border/50 bg-card-header p-6">
				<CardTitle className="flex items-center gap-2">
					<Shield className="size-5" />
					Two-Factor Authentication
					{twoFactorStatus.data && (
						<Badge variant={twoFactorStatus.data.enabled ? "success" : "secondary"} className="ml-2">
							{twoFactorStatus.data.enabled ? "Enabled" : "Disabled"}
						</Badge>
					)}
				</CardTitle>
				<CardDescription className="mt-1.5">Add an extra layer of security to your account</CardDescription>
			</div>
			<CardContent className="p-6">
				<p className="text-sm text-muted-foreground max-w-2xl mb-4">
					Two-factor authentication adds an additional layer of security by requiring a time-based code from your
					authenticator app when logging in.
				</p>

				{twoFactorStatus.data?.enabled ? (
					<Dialog
						open={disable2faDialogOpen}
						onOpenChange={(open) => {
							setDisable2faDialogOpen(open);
							if (!open) resetDisable2faDialog();
						}}
					>
						<DialogTrigger asChild>
							<Button variant="destructive">
								<Shield size={16} className="mr-2" />
								Disable 2FA
							</Button>
						</DialogTrigger>
						<DialogContent>
							<form onSubmit={handleDisable2fa}>
								<DialogHeader>
									<DialogTitle>Disable Two-Factor Authentication</DialogTitle>
									<DialogDescription>
										To disable 2FA, please enter your password and a code from your authenticator app.
									</DialogDescription>
								</DialogHeader>
								<div className="space-y-4 py-4">
									<div className="space-y-2">
										<Label htmlFor="disable-2fa-password">Your Password</Label>
										<Input
											id="disable-2fa-password"
											type="password"
											value={disable2faPassword}
											onChange={(e) => setDisable2faPassword(e.target.value)}
											placeholder="Enter your password"
											required
											autoFocus
										/>
									</div>
									<div className="space-y-2">
										<Label htmlFor="disable-2fa-code">Authenticator Code</Label>
										<Input
											id="disable-2fa-code"
											type="text"
											inputMode="numeric"
											pattern="[0-9]*"
											maxLength={6}
											value={disable2faCode}
											onChange={(e) => setDisable2faCode(e.target.value.replace(/\D/g, ""))}
											placeholder="000000"
											required
											className="font-mono tracking-widest"
										/>
									</div>
								</div>
								<DialogFooter>
									<Button
										type="button"
										variant="outline"
										onClick={() => {
											setDisable2faDialogOpen(false);
											resetDisable2faDialog();
										}}
									>
										<X className="h-4 w-4 mr-2" />
										Cancel
									</Button>
									<Button type="submit" variant="destructive" loading={disable2fa.isPending}>
										<Shield className="h-4 w-4 mr-2" />
										Disable 2FA
									</Button>
								</DialogFooter>
							</form>
						</DialogContent>
					</Dialog>
				) : (
					<Dialog
						open={enable2faDialogOpen}
						onOpenChange={(open) => {
							setEnable2faDialogOpen(open);
							if (!open) resetEnable2faDialog();
						}}
					>
						<DialogTrigger asChild>
							<Button variant="outline" onClick={handleStartEnable2fa}>
								<Shield size={16} className="mr-2" />
								Enable 2FA
							</Button>
						</DialogTrigger>
						<DialogContent className="sm:max-w-md">
							{enable2faStep === "setup" ? (
								<>
									<DialogHeader>
										<DialogTitle>Setting up 2FA...</DialogTitle>
										<DialogDescription>Please wait while we generate your secret key.</DialogDescription>
									</DialogHeader>
									<div className="flex items-center justify-center py-8">
										<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
									</div>
								</>
							) : (
								<form onSubmit={handleConfirmEnable2fa}>
									<DialogHeader>
										<DialogTitle>Enable Two-Factor Authentication</DialogTitle>
										<DialogDescription>
											Scan the QR code with your authenticator app (like Google Authenticator, Authy, or 1Password),
											then enter the 6-digit code to verify.
										</DialogDescription>
									</DialogHeader>
									<div className="space-y-4 py-4">
										<div className="flex justify-center">
											<div className="p-4 bg-white rounded-lg">
												<QRCodeSVG value={enable2faUri} size={192} />
											</div>
										</div>
										<div className="space-y-2">
											<Label>Manual Entry Key</Label>
											<div className="flex gap-2">
												<Input value={enable2faSecret} readOnly className="font-mono text-sm" />
												<Button type="button" variant="outline" size="icon" onClick={handleCopySecret}>
													<Copy className="h-4 w-4" />
												</Button>
											</div>
											<p className="text-xs text-muted-foreground">
												If you can't scan the QR code, enter this key manually in your authenticator app.
											</p>
										</div>
										<div className="space-y-2">
											<Label htmlFor="enable-2fa-password">Your Password</Label>
											<Input
												id="enable-2fa-password"
												type="password"
												value={enable2faPassword}
												onChange={(e) => setEnable2faPassword(e.target.value)}
												placeholder="Enter your password"
												required
											/>
										</div>
										<div className="space-y-2">
											<Label htmlFor="enable-2fa-code">Verification Code</Label>
											<Input
												id="enable-2fa-code"
												type="text"
												inputMode="numeric"
												pattern="[0-9]*"
												maxLength={6}
												value={enable2faCode}
												onChange={(e) => setEnable2faCode(e.target.value.replace(/\D/g, ""))}
												placeholder="000000"
												required
												className="font-mono tracking-widest"
											/>
										</div>
									</div>
									<DialogFooter>
										<Button
											type="button"
											variant="outline"
											onClick={() => {
												setEnable2faDialogOpen(false);
												resetEnable2faDialog();
											}}
										>
											<X className="h-4 w-4 mr-2" />
											Cancel
										</Button>
										<Button type="submit" loading={enable2fa.isPending}>
											<Shield className="h-4 w-4 mr-2" />
											Enable 2FA
										</Button>
									</DialogFooter>
								</form>
							)}
						</DialogContent>
					</Dialog>
				)}
			</CardContent>

			<div className="border-t border-border/50 bg-card-header p-6">
				<CardTitle className="flex items-center gap-2">
					<Download className="size-5" />
					Backup Recovery Key
				</CardTitle>
				<CardDescription className="mt-1.5">Download your Restic password file for disaster recovery</CardDescription>
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
							Download Restic Password
						</Button>
					</DialogTrigger>
					<DialogContent>
						<form onSubmit={handleDownloadResticPassword}>
							<DialogHeader>
								<DialogTitle>Download Restic Password</DialogTitle>
								<DialogDescription>
									For security reasons, please enter your account password to download the Restic password file.
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
										autoFocus
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
		</Card>
	);
}
