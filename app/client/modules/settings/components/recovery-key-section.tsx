import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Download, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { downloadResticPasswordMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { Alert, AlertDescription, AlertTitle } from "~/client/components/ui/alert";
import { Button } from "~/client/components/ui/button";
import { CardContent, CardDescription, CardTitle } from "~/client/components/ui/card";
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
import { parseError } from "~/client/lib/errors";
import { cn } from "~/client/lib/utils";

const RECOVERY_KEY_PASSWORD_REQUIRED_MESSAGE =
	"Downloading the recovery key requires a local password. Ask an operator to run `docker exec -it zerobyte bun run cli reset-password` for your user, then sign in with that password and try again.";

type Props = {
	passwordAuthSupported: boolean;
	hasPassword: boolean;
};

export function RecoveryKeySection({ passwordAuthSupported, hasPassword }: Props) {
	const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
	const [downloadPassword, setDownloadPassword] = useState("");
	const [downloadBlockedMessage, setDownloadBlockedMessage] = useState<string | null>(null);
	const canDownloadRecoveryKey = !passwordAuthSupported || hasPassword;

	const downloadResticPassword = useMutation({
		...downloadResticPasswordMutation(),
		onSuccess: (data) => {
			const blob = new Blob([data], { type: "text/plain" });
			const url = window.URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = "restic.pass";
			document.body.appendChild(anchor);
			anchor.click();
			document.body.removeChild(anchor);
			window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);

			toast.success("Restic password file downloaded successfully");
			setDownloadDialogOpen(false);
			setDownloadPassword("");
			setDownloadBlockedMessage(null);
		},
		onError: (error) => {
			const message = parseError(error)?.message;
			const blockedMessage = message?.includes("local password") ? message : null;
			setDownloadBlockedMessage(blockedMessage);
			toast.error("Failed to download Restic password", {
				description: message,
			});
		},
	});

	const handleDownloadResticPassword = (event: React.SubmitEvent) => {
		event.preventDefault();

		if (passwordAuthSupported && !downloadPassword) {
			toast.error("Password is required");
			return;
		}

		setDownloadBlockedMessage(null);
		const password = passwordAuthSupported ? downloadPassword : "";
		downloadResticPassword.mutate({ body: { password } });
	};

	const handleCancel = () => {
		setDownloadDialogOpen(false);
		setDownloadPassword("");
	};

	let dialogDescription = "Download the recovery key file and store it somewhere safe.";
	if (passwordAuthSupported && !hasPassword) {
		dialogDescription = "A local password is required before this recovery key can be downloaded.";
	} else if (passwordAuthSupported) {
		dialogDescription =
			"For security reasons, please enter your account password to download the recovery key file.";
	}

	const hideWarning = !passwordAuthSupported || (hasPassword && !downloadBlockedMessage);
	const hidePasswordField = !passwordAuthSupported || !hasPassword;

	return (
		<>
			<div className="border-b border-border/50 bg-card-header p-6">
				<CardTitle className="flex items-center gap-2">
					<Download className="size-5" />
					Backup Recovery Key
				</CardTitle>
				<CardDescription className="mt-1.5">
					Download the recovery key used by this organization&apos;s Restic repositories
				</CardDescription>
			</div>
			<CardContent className="p-6 space-y-4">
				<p className="text-sm text-muted-foreground max-w-2xl">
					This file contains the encryption password used by Restic to secure this organization&apos;s
					backups. Store it in a password manager or other encrypted storage. You will need it to recover
					backup data if this server becomes unavailable.
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
								<DialogDescription>{dialogDescription}</DialogDescription>
							</DialogHeader>
							<div className="space-y-4 py-4">
								<Alert variant="warning" className={cn({ hidden: hideWarning })}>
									<AlertTriangle className="size-5" />
									<AlertTitle>Local password required</AlertTitle>
									<AlertDescription>
										{downloadBlockedMessage ?? RECOVERY_KEY_PASSWORD_REQUIRED_MESSAGE}
									</AlertDescription>
								</Alert>
								<div className={cn("space-y-2", { hidden: hidePasswordField })}>
									<Label htmlFor="download-password">Your Password</Label>
									<Input
										id="download-password"
										type="password"
										value={downloadPassword}
										onChange={(event) => setDownloadPassword(event.target.value)}
										placeholder="Enter your password"
										required={passwordAuthSupported && hasPassword}
									/>
								</div>
							</div>
							<DialogFooter>
								<Button type="button" variant="outline" onClick={handleCancel}>
									<X className="mr-2 size-4" />
									Cancel
								</Button>
								<Button
									type="submit"
									loading={downloadResticPassword.isPending}
									className={cn({ hidden: !canDownloadRecoveryKey })}
								>
									<Download className="mr-2 size-4" />
									Download
								</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>
			</CardContent>
		</>
	);
}
