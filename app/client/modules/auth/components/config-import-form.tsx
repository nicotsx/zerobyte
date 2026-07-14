import { useMutation } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { importConfigMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { Button } from "~/client/components/ui/button";
import { Input } from "~/client/components/ui/input";
import { Label } from "~/client/components/ui/label";
import { SecretInput } from "~/client/components/ui/secret-input";
import {
	CONFIG_TRANSFER_MAX_FILE_BYTES,
	CONFIG_TRANSFER_PASSPHRASE_MAX_LENGTH,
	CONFIG_TRANSFER_PASSPHRASE_MIN_LENGTH,
} from "~/lib/config-transfer";

type ConfigImportFormProps = {
	onImportSuccess: () => void;
};

export function ConfigImportForm({ onImportSuccess }: ConfigImportFormProps) {
	const [importFile, setImportFile] = useState<File | null>(null);
	const [exportPassphrase, setExportPassphrase] = useState("");
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

			onImportSuccess();
		},
		onError: (error) => {
			toast.error("Failed to import configuration", { description: error.message });
		},
	});

	const handleSubmit = async (event: React.SubmitEvent) => {
		event.preventDefault();

		if (!importFile) {
			toast.error("Export file is required");
			return;
		}

		if (importFile.size > CONFIG_TRANSFER_MAX_FILE_BYTES) {
			toast.error("Export file is too large");
			return;
		}

		if (exportPassphrase.length < CONFIG_TRANSFER_PASSPHRASE_MIN_LENGTH) {
			toast.error(`Export passphrase must be at least ${CONFIG_TRANSFER_PASSPHRASE_MIN_LENGTH} characters`);
			return;
		}

		const encryptedConfig = await importFile.text();
		importConfig.mutate({
			body: {
				encryptedConfig,
				exportPassphrase,
			},
		});
	};

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<div className="space-y-1">
				<h2 className="text-sm font-medium">Or import a previous configuration</h2>
				<p className="text-xs text-muted-foreground">
					Use a passphrase-protected export from another Zerobyte instance. Imported local directory volumes
					and local repositories will require review, and dependent schedules will stay disabled until you
					validate those paths on this server.
				</p>
			</div>

			<div className="space-y-2">
				<Label htmlFor="config-file">Encrypted export file</Label>
				<Input
					id="config-file"
					type="file"
					accept=".zbex"
					onChange={(event) => {
						const selectedFile = event.target.files?.[0] ?? null;
						setImportFile(selectedFile);
					}}
					disabled={importConfig.isPending}
				/>
			</div>

			<div className="space-y-2">
				<Label htmlFor="export-passphrase">Export passphrase</Label>
				<SecretInput
					id="export-passphrase"
					value={exportPassphrase}
					onChange={(event) => setExportPassphrase(event.target.value)}
					placeholder="Enter the passphrase used to protect this export"
					autoComplete="off"
					minLength={CONFIG_TRANSFER_PASSPHRASE_MIN_LENGTH}
					maxLength={CONFIG_TRANSFER_PASSPHRASE_MAX_LENGTH}
					required
					disabled={importConfig.isPending}
				/>
				<p className="text-xs text-muted-foreground">
					This is the export passphrase, not your account password or either instance&apos;s APP_SECRET.
				</p>
			</div>

			<div className="flex flex-col gap-2">
				<Button type="submit" variant="outline" loading={importConfig.isPending} className="w-full">
					<Upload size={16} className="mr-2" />
					Import configuration
				</Button>
			</div>
		</form>
	);
}
