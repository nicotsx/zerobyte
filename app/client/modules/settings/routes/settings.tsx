import { useMutation } from "@tanstack/react-query";
import { Download, KeyRound, User, X } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { downloadResticPasswordMutation } from "~/client/api-client/@tanstack/react-query.gen";
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
import { authClient } from "~/client/lib/auth-client";
import { appContext } from "~/context";
import { TwoFactorSection } from "../components/two-factor-section";
import { SSOSection } from "../components/sso-section";
import type { Route } from "./+types/settings";
import { listSsoProviders } from "~/client/api-client";

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

export async function clientLoader({ context }: Route.ClientLoaderArgs) {
	const ctx = context.get(appContext);
	const providers = await listSsoProviders();
	const accounts = await authClient.listAccounts();

	return { ...ctx, ssoProviders: providers.data ?? [], userAccounts: accounts.data ?? [] };
}

export default function Settings({ loaderData }: Route.ComponentProps) {
	const { user } = loaderData;
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
	const [downloadPassword, setDownloadPassword] = useState("");
	const [isChangingPassword, setIsChangingPassword] = useState(false);

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
			toast.error("Failed to download Restic password", {
				description: error.message,
			});
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
					<Input value={user?.username} disabled className="max-w-md" />
				</div>
				{/* <div className="space-y-2"> */}
				{/* 	<Label>Email</Label> */}
				{/* 	<Input value={loaderData.user?.email || ""} disabled className="max-w-md" /> */}
				{/* </div> */}
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
			<TwoFactorSection twoFactorEnabled={user?.twoFactorEnabled} />
			<SSOSection providers={loaderData.ssoProviders} userAccounts={loaderData.userAccounts} />
		</Card>
	);
}
