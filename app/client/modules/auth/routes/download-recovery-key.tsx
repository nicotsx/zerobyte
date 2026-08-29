import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, CheckCircle2, Download, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { downloadResticPasswordMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { AuthLayout } from "~/client/components/auth-layout";
import { Alert, AlertDescription, AlertTitle } from "~/client/components/ui/alert";
import { Button, buttonVariants } from "~/client/components/ui/button";
import { Input } from "~/client/components/ui/input";
import { Label } from "~/client/components/ui/label";
import { downloadFile } from "~/client/lib/download";
import { ConfigImportForm } from "~/client/modules/auth/components/config-import-form";
import { parseError } from "~/client/lib/errors";
import {
	RECOVERY_KEY_DOWNLOAD_SKIPPED_COOKIE_MAX_AGE,
	RECOVERY_KEY_DOWNLOAD_SKIPPED_COOKIE_NAME,
} from "~/lib/recovery-key-skip";

const RECOVERY_KEY_PASSWORD_REQUIRED_MESSAGE =
	"Downloading the recovery key requires a local password. Ask an operator to run `docker exec -it zerobyte bun run cli reset-password` for your user, then sign in with that password and try again.";

type Props = {
	passwordAuthSupported: boolean;
	hasPassword: boolean;
	userId: string | null;
	runtime: "server" | "desktop";
};

export function DownloadRecoveryKeyPage({ passwordAuthSupported, hasPassword, userId, runtime }: Props) {
	const navigate = useNavigate();
	const [password, setPassword] = useState("");
	const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
	const [importWarnings, setImportWarnings] = useState<string[] | null>(null);
	const isDesktopRuntime = runtime === "desktop";
	const goToVolumes = () => {
		void navigate({ to: "/volumes", replace: true });
	};

	const downloadResticPassword = useMutation({
		...downloadResticPasswordMutation(),
		onSuccess: (data) => {
			downloadFile({
				content: data,
				contentType: "text/plain",
				fileName: "restic.pass",
			});

			toast.success("Recovery key downloaded successfully!");
			setBlockedMessage(null);
			goToVolumes();
		},
		onError: (error) => {
			const message = parseError(error)?.message;
			setBlockedMessage(message?.includes("local password") ? message : null);
			toast.error("Failed to download recovery key", { description: message });
		},
	});

	const handleSubmit = (event: React.SubmitEvent) => {
		event.preventDefault();

		if (passwordAuthSupported && !password) {
			toast.error("Password is required");
			return;
		}

		setBlockedMessage(null);
		const accountPassword = passwordAuthSupported ? password : "";
		downloadResticPassword.mutate({
			body: { password: accountPassword },
		});
	};

	const handleSkip = () => {
		if (!userId) return;

		document.cookie = `${RECOVERY_KEY_DOWNLOAD_SKIPPED_COOKIE_NAME}=${userId}; path=/; max-age=${RECOVERY_KEY_DOWNLOAD_SKIPPED_COOKIE_MAX_AGE}`;
		goToVolumes();
	};

	if (importWarnings !== null) {
		const hasWarnings = importWarnings.length > 0;
		const description = hasWarnings
			? "Your configuration was imported, but some items need your attention."
			: "Your configuration is ready to use.";
		const alertVariant = hasWarnings ? "warning" : "default";
		const alertTitle = hasWarnings ? "Review required" : "Import complete";
		const continueLabel = hasWarnings ? "I understand, continue" : "Continue";

		return (
			<AuthLayout title="Configuration imported" description={description}>
				<div className="space-y-6">
					<Alert variant={alertVariant}>
						{hasWarnings ? <AlertTriangle className="size-5" /> : <CheckCircle2 className="size-5" />}
						<AlertTitle>{alertTitle}</AlertTitle>
						<AlertDescription className="space-y-3">
							{hasWarnings ? (
								<>
									<p>
										The export contains settings and credentials, not backup data. Restore or mount
										these local resources before using them:
									</p>
									<ul className="list-disc space-y-2 break-words pl-5">
										{importWarnings.map((warning) => (
											<li key={warning}>{warning}</li>
										))}
									</ul>
									<p>Affected schedules stay disabled until you validate their paths.</p>
								</>
							) : (
								<p>Your repositories, volumes, schedules, and notifications were imported.</p>
							)}
						</AlertDescription>
					</Alert>

					<Button variant="primary" className="w-full" onClick={goToVolumes}>
						{continueLabel}
						<ArrowRight className="ml-2 size-4" />
					</Button>
				</div>
			</AuthLayout>
		);
	}

	return (
		<AuthLayout
			title="Download Your Recovery Key"
			description="This is a critical step to ensure you can recover your backups"
		>
			{isDesktopRuntime && (
				<Alert variant="warning" className="mb-3">
					<AlertTriangle className="size-5" />
					<AlertTitle>Zerobyte Alpha</AlertTitle>
					<AlertDescription>
						This desktop app is an early Alpha. Expect changes, verify restores, and keep this recovery key
						somewhere outside the app.
					</AlertDescription>
				</Alert>
			)}
			<Alert variant="warning" className="mb-6">
				<AlertTriangle className="size-5" />
				<AlertTitle>Important: Save This File Securely</AlertTitle>
				<AlertDescription>
					Your Restic password is essential for recovering your backup data. If you previously downloaded this
					file, make sure the contents of the new one matches the previous one. If you have any doubt, keep
					both copies safely. If you lose access to this server without this file, your backups will be
					unrecoverable. Store it in a password manager or encrypted storage.
				</AlertDescription>
			</Alert>

			<form onSubmit={handleSubmit} className="space-y-4">
				{passwordAuthSupported && (!hasPassword || blockedMessage) && (
					<Alert variant="warning">
						<AlertTriangle className="size-5" />
						<AlertTitle>Local password required</AlertTitle>
						<AlertDescription>{blockedMessage ?? RECOVERY_KEY_PASSWORD_REQUIRED_MESSAGE}</AlertDescription>
					</Alert>
				)}

				{passwordAuthSupported && hasPassword && (
					<div className="space-y-2">
						<Label htmlFor="password">Confirm Your Password</Label>
						<Input
							id="password"
							type="password"
							value={password}
							onChange={(event) => setPassword(event.target.value)}
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
					{(!passwordAuthSupported || hasPassword) && (
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

			<div className="my-6 border-t border-border/60" />

			<details>
				<summary className={buttonVariants({ variant: "link", className: "list-none px-0" })}>
					<Upload className="mr-2 size-4" />
					Import configuration
				</summary>
				<div className="mt-6">
					<ConfigImportForm onSuccess={setImportWarnings} />
				</div>
			</details>
		</AuthLayout>
	);
}
