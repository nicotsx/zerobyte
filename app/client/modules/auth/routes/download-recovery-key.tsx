import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Download } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { AuthLayout } from "~/client/components/auth-layout";
import { Alert, AlertDescription, AlertTitle } from "~/client/components/ui/alert";
import { Button } from "~/client/components/ui/button";
import { Input } from "~/client/components/ui/input";
import { Label } from "~/client/components/ui/label";
import { authMiddleware } from "~/middleware/auth";
import type { Route } from "./+types/download-recovery-key";
import { downloadResticPasswordMutation } from "~/client/api-client/@tanstack/react-query.gen";

export const clientMiddleware = [authMiddleware];

export function meta(_: Route.MetaArgs) {
	return [
		{ title: "Zerobyte - Download Recovery Key" },
		{
			name: "description",
			content: "Download your backup recovery key to ensure you can restore your data.",
		},
	];
}

export default function DownloadRecoveryKeyPage() {
	const navigate = useNavigate();
	const [password, setPassword] = useState("");

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

			toast.success("Recovery key downloaded successfully!");
			void navigate("/volumes", { replace: true });
		},
		onError: (error) => {
			toast.error("Failed to download recovery key", { description: error.message });
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();

		if (!password) {
			toast.error("Password is required");
			return;
		}

		downloadResticPassword.mutate({
			body: {
				password,
			},
		});
	};

	return (
		<AuthLayout
			title="Download Your Recovery Key"
			description="This is a critical step to ensure you can recover your backups"
		>
			<Alert variant="warning" className="mb-6">
				<AlertTriangle className="size-5" />
				<AlertTitle>Important: Save This File Securely</AlertTitle>
				<AlertDescription>
					Your Restic password is essential for recovering your backup data. If you lose access to this server without
					this file, your backups will be unrecoverable. Store it in a password manager or encrypted storage.
				</AlertDescription>
			</Alert>

			<form onSubmit={handleSubmit} className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="password">Confirm Your Password</Label>
					<Input
						id="password"
						type="password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						placeholder="Enter your password"
						required
						disabled={downloadResticPassword.isPending}
					/>
					<p className="text-xs text-muted-foreground">Enter your account password to download the recovery key</p>
				</div>

				<div className="flex flex-col gap-2">
					<Button type="submit" loading={downloadResticPassword.isPending} className="w-full">
						<Download size={16} className="mr-2" />
						Download Recovery Key
					</Button>
				</div>
			</form>
		</AuthLayout>
	);
}
