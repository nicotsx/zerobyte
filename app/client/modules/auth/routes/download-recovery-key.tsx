import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Download, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { downloadResticPasswordMutation, importConfigMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { AuthLayout } from "~/client/components/auth-layout";
import { Alert, AlertDescription, AlertTitle } from "~/client/components/ui/alert";
import { Button } from "~/client/components/ui/button";
import { Input } from "~/client/components/ui/input";
import { Label } from "~/client/components/ui/label";
import { downloadFile } from "~/client/lib/download";
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
};

export function DownloadRecoveryKeyPage({ passwordAuthSupported, hasPassword, userId }: Props) {
	const navigate = useNavigate();
	const [password, setPassword] = useState("");
	const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
	const [importFile, setImportFile] = useState<File | null>(null);
	const [sourceAppSecret, setSourceAppSecret] = useState("");

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
			void navigate({ to: "/volumes", replace: true });
		},
		onError: (error) => {
			const message = parseError(error)?.message;
			setBlockedMessage(message?.includes("local password") ? message : null);
			toast.error("Failed to download recovery key", { description: message });
		},
	});

	const importConfig = useMutation({
		...importConfigMutation(),
		onSuccess: (data) => {
			if (data.warnings.length > 0) {
				toast.warning("Configuration imported with warnings", {
					description: data.warnings.join("\n"),
				});
			} else {
				toast.success("Configuration imported successfully!");
			}

			void navigate({ to: "/volumes", replace: true });
		},
		onError: (error) => {
			toast.error("Failed to import configuration", { description: error.message });
		},
	});

	const handleSubmit = (e: React.SubmitEvent) => {
		e.preventDefault();

		if (passwordAuthSupported && !password) {
			toast.error("Password is required");
			return;
		}

		setBlockedMessage(null);
		downloadResticPassword.mutate({
			body: { password: passwordAuthSupported ? password : "" },
		});
	};

	const handleSkip = () => {
		if (!userId) return;

		document.cookie = `${RECOVERY_KEY_DOWNLOAD_SKIPPED_COOKIE_NAME}=${userId}; path=/; max-age=${RECOVERY_KEY_DOWNLOAD_SKIPPED_COOKIE_MAX_AGE}`;
		void navigate({ to: "/volumes", replace: true });
	};

	const handleImportSubmit = async (e: React.SubmitEvent) => {
		e.preventDefault();

		if (!importFile) {
			toast.error("Export file is required");
			return;
		}

		if (!sourceAppSecret) {
			toast.error("Source APP_SECRET is required");
			return;
		}

		const encryptedConfig = await importFile.text();

		importConfig.mutate({
			body: {
				encryptedConfig,
				sourceAppSecret,
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
							onChange={(e) => setPassword(e.target.value)}
							placeholder="Enter your password"
							required
							disabled={downloadResticPassword.isPending}
						/>
						<p className="text-xs text-muted-foreground">Enter your account password to download the recovery key</p>
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

			<form onSubmit={handleImportSubmit} className="space-y-4">
				<div className="space-y-1">
					<h2 className="text-sm font-medium">Or import a previous configuration</h2>
					<p className="text-xs text-muted-foreground">
						Use an encrypted export file from another Zerobyte instance and its source APP_SECRET. Imported local
						directory volumes and local repositories will require review, and dependent schedules will stay disabled
						until you validate those paths on this server.
					</p>
				</div>

				<div className="space-y-2">
					<Label htmlFor="config-file">Encrypted export file</Label>
					<Input
						id="config-file"
						type="file"
						accept=".zbex,.txt"
						onChange={(e) => {
							setImportFile(e.target.files?.[0] ?? null);
						}}
						disabled={importConfig.isPending}
					/>
				</div>

				<div className="space-y-2">
					<Label htmlFor="source-app-secret">Source APP_SECRET</Label>
					<Input
						id="source-app-secret"
						type="password"
						value={sourceAppSecret}
						onChange={(e) => setSourceAppSecret(e.target.value)}
						placeholder="Enter the source APP_SECRET"
						required
						disabled={importConfig.isPending}
					/>
				</div>

				<div className="flex flex-col gap-2">
					<Button type="submit" variant="outline" loading={importConfig.isPending} className="w-full">
						<Upload size={16} className="mr-2" />
						Import configuration
					</Button>
				</div>
			</form>
		</AuthLayout>
	);
}
