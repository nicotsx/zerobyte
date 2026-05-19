import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AuthLayout } from "~/client/components/auth-layout";
import { Alert, AlertDescription, AlertTitle } from "~/client/components/ui/alert";
import { Button } from "~/client/components/ui/button";
import { Input } from "~/client/components/ui/input";
import { Label } from "~/client/components/ui/label";
import { downloadResticPasswordMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { parseError } from "~/client/lib/errors";
import {
	RECOVERY_KEY_DOWNLOAD_SKIPPED_COOKIE_MAX_AGE,
	RECOVERY_KEY_DOWNLOAD_SKIPPED_COOKIE_NAME,
} from "~/lib/recovery-key-skip";
import { useNavigate } from "@tanstack/react-router";

const RECOVERY_KEY_CREDENTIAL_REQUIRED_MESSAGE =
	"Downloading the recovery key requires a local credential password. Ask an operator to run `docker exec -it zerobyte bun run cli reset-password` for your user, then sign in with that password and try again.";

type Props = {
	hasCredentialPassword: boolean;
	userId: string | null;
};

export function DownloadRecoveryKeyPage({ hasCredentialPassword, userId }: Props) {
	const navigate = useNavigate();
	const [password, setPassword] = useState("");
	const [blockedMessage, setBlockedMessage] = useState<string | null>(null);

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
			window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);

			toast.success("Recovery key downloaded successfully!");
			setBlockedMessage(null);
			void navigate({ to: "/volumes", replace: true });
		},
		onError: (error) => {
			const message = parseError(error)?.message;
			setBlockedMessage(message?.includes("credential password") ? message : null);
			toast.error("Failed to download recovery key", { description: message });
		},
	});

	const handleSubmit = (e: React.SubmitEvent) => {
		e.preventDefault();

		if (!password) {
			toast.error("Password is required");
			return;
		}

		setBlockedMessage(null);
		downloadResticPassword.mutate({ body: { password } });
	};

	const handleSkip = () => {
		if (!userId) return;

		document.cookie = `${RECOVERY_KEY_DOWNLOAD_SKIPPED_COOKIE_NAME}=${userId}; path=/; max-age=${RECOVERY_KEY_DOWNLOAD_SKIPPED_COOKIE_MAX_AGE}`;
		void navigate({ to: "/volumes", replace: true });
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
					Your Restic password is essential for recovering your backup data. If you previously downloaded this
					file, replace that saved copy with the new download. If you lose access to this server without this
					file, your backups will be unrecoverable. Store it in a password manager or encrypted storage.
				</AlertDescription>
			</Alert>

			<form onSubmit={handleSubmit} className="space-y-4">
				{(!hasCredentialPassword || blockedMessage) && (
					<Alert variant="warning">
						<AlertTriangle className="size-5" />
						<AlertTitle>Local password required</AlertTitle>
						<AlertDescription>
							{blockedMessage ?? RECOVERY_KEY_CREDENTIAL_REQUIRED_MESSAGE}
						</AlertDescription>
					</Alert>
				)}

				{hasCredentialPassword && (
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
						<p className="text-xs text-muted-foreground">
							Enter your account password to download the recovery key
						</p>
					</div>
				)}

				<div className="flex flex-col gap-2">
					{hasCredentialPassword && (
						<Button type="submit" loading={downloadResticPassword.isPending} className="w-full">
							<Download size={16} className="mr-2" />
							Download Recovery Key
						</Button>
					)}
					<Button
						type="button"
						variant="ghost"
						onClick={handleSkip}
						disabled={downloadResticPassword.isPending}
						className="w-full"
					>
						Skip
					</Button>
				</div>
			</form>
		</AuthLayout>
	);
}
