import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { exportConfigMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { Button } from "~/client/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "~/client/components/ui/alert";
import { Label } from "~/client/components/ui/label";
import { SecretInput } from "~/client/components/ui/secret-input";
import { downloadFile } from "~/client/lib/download";
import { PasswordProtectedActionDialog } from "~/client/modules/settings/components/password-protected-action-dialog";
import { CONFIG_TRANSFER_PASSPHRASE_MAX_LENGTH, CONFIG_TRANSFER_PASSPHRASE_MIN_LENGTH } from "~/lib/config-transfer";

type Props = {
	hasPassword: boolean;
	passwordAuthSupported: boolean;
};

export function ConfigExportDialog({ hasPassword, passwordAuthSupported }: Props) {
	const [exportPassphrase, setExportPassphrase] = useState("");
	const [exportPassphraseConfirmation, setExportPassphraseConfirmation] = useState("");
	const exportConfiguration = useMutation(exportConfigMutation());

	const resetExportPassphrase = () => {
		setExportPassphrase("");
		setExportPassphraseConfirmation("");
	};

	const generatePassphrase = () => {
		setExportPassphrase(crypto.randomUUID().replaceAll("-", ""));
		setExportPassphraseConfirmation("");
		toast.info("Strong passphrase generated", {
			description: "Save it somewhere safe, then confirm it below before exporting.",
		});
	};

	const validateExport = () => {
		if (exportPassphrase.length < CONFIG_TRANSFER_PASSPHRASE_MIN_LENGTH) {
			toast.error(`Export passphrase must be at least ${CONFIG_TRANSFER_PASSPHRASE_MIN_LENGTH} characters`);
			return false;
		}
		if (exportPassphrase !== exportPassphraseConfirmation) {
			toast.error("Export passphrases do not match");
			return false;
		}

		return true;
	};

	const handleExport = async (password: string) => {
		const content = await exportConfiguration.mutateAsync({
			body: {
				password,
				exportPassphrase,
			},
		});
		downloadFile({ content, contentType: "text/plain", fileName: "zerobyte-config.zbex" });
		toast.success("Encrypted configuration exported successfully");
	};
	const action = {
		title: "Export Encrypted Configuration",
		description: "Export a configuration file encrypted with a dedicated passphrase.",
		trigger: (
			<Button variant="outline">
				<Download className="mr-2 size-4" />
				Export encrypted config
			</Button>
		),
		submitLabel: "Export",
		submitIcon: <Download className="mr-2 size-4" />,
		isPending: exportConfiguration.isPending,
		failureMessage: "Failed to export configuration",
		onSubmit: handleExport,
	};

	return (
		<PasswordProtectedActionDialog
			hasPassword={hasPassword}
			passwordAuthSupported={passwordAuthSupported}
			action={action}
			validateAction={validateExport}
			onClose={resetExportPassphrase}
		>
			<div className="space-y-4">
				<Alert variant="warning">
					<AlertTriangle className="size-5" />
					<AlertTitle>Configuration only</AlertTitle>
					<AlertDescription>
						This export does not include backup data or volume contents. Preserve and migrate local
						repository directories separately.
					</AlertDescription>
				</Alert>

				<div className="space-y-2">
					<div className="flex items-center justify-between gap-2">
						<Label htmlFor="config-export-passphrase">Export passphrase</Label>
						<Button type="button" variant="outline" size="sm" onClick={generatePassphrase}>
							Generate strong passphrase
						</Button>
					</div>
					<SecretInput
						id="config-export-passphrase"
						value={exportPassphrase}
						onChange={(event) => setExportPassphrase(event.target.value)}
						placeholder={`At least ${CONFIG_TRANSFER_PASSPHRASE_MIN_LENGTH} characters`}
						autoComplete="new-password"
						minLength={CONFIG_TRANSFER_PASSPHRASE_MIN_LENGTH}
						maxLength={CONFIG_TRANSFER_PASSPHRASE_MAX_LENGTH}
						required
					/>
					<p className="text-xs text-muted-foreground">
						You will need this passphrase to import the file. Zerobyte cannot recover it for you.
					</p>
				</div>
				<div className="space-y-2">
					<Label htmlFor="config-export-passphrase-confirmation">Confirm export passphrase</Label>
					<SecretInput
						id="config-export-passphrase-confirmation"
						value={exportPassphraseConfirmation}
						onChange={(event) => setExportPassphraseConfirmation(event.target.value)}
						autoComplete="new-password"
						minLength={CONFIG_TRANSFER_PASSPHRASE_MIN_LENGTH}
						maxLength={CONFIG_TRANSFER_PASSPHRASE_MAX_LENGTH}
						required
					/>
				</div>
			</div>
		</PasswordProtectedActionDialog>
	);
}
