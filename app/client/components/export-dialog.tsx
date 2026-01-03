import { useMutation } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { exportFullConfigMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { Button } from "~/client/components/ui/button";
import { Checkbox } from "~/client/components/ui/checkbox";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";

type SecretsMode = "exclude" | "encrypted" | "cleartext";

const DEFAULT_EXPORT_FILENAME = "zerobyte-full-config";

function downloadAsJson(data: unknown, filename: string): void {
	const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `${filename}.json`;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

type BaseExportDialogProps = {
	/** Optional custom filename (without extension). Defaults to `zerobyte-full-config`. */
	filename?: string;
};

type ExportDialogWithTrigger = BaseExportDialogProps & {
	/** Custom trigger element. When provided, variant/size/triggerLabel/showIcon are ignored. */
	trigger: ReactNode;
	variant?: never;
	size?: never;
	triggerLabel?: never;
	showIcon?: never;
};

type ExportDialogWithDefaultTrigger = BaseExportDialogProps & {
	trigger?: never;
	variant?: "default" | "outline" | "ghost" | "card";
	size?: "default" | "sm" | "lg" | "icon";
	triggerLabel?: string;
	showIcon?: boolean;
};

type ExportDialogProps = ExportDialogWithTrigger | ExportDialogWithDefaultTrigger;

export function ExportDialog({
	filename = DEFAULT_EXPORT_FILENAME,
	trigger,
	variant = "outline",
	size = "default",
	triggerLabel,
	showIcon = true,
}: ExportDialogProps) {
	const [open, setOpen] = useState(false);
	const [includeMetadata, setIncludeMetadata] = useState(false);
	const [includeRecoveryKey, setIncludeRecoveryKey] = useState(false);
	const [includePasswordHash, setIncludePasswordHash] = useState(false);
	const [secretsMode, setSecretsMode] = useState<SecretsMode>("exclude");
	const [password, setPassword] = useState("");

	const handleExportSuccess = (data: unknown) => {
		downloadAsJson(data, filename);
		toast.success("Configuration exported successfully");
		setOpen(false);
		setPassword("");
	};

	const handleExportError = (error: unknown) => {
		const message =
			error && typeof error === "object" && "error" in error ? (error as { error: string }).error : "Unknown error";
		toast.error("Export failed", {
			description: message,
		});
	};

	const exportMutation = useMutation({
		...exportFullConfigMutation(),
		onSuccess: handleExportSuccess,
		onError: handleExportError,
	});

	const handleExport = (e: React.FormEvent) => {
		e.preventDefault();
		if (!password) {
			toast.error("Password is required");
			return;
		}

		exportMutation.mutate({
			body: {
				password,
				includeMetadata,
				secretsMode,
				includeRecoveryKey,
				includePasswordHash,
			},
		});
	};

	const handleDialogChange = (isOpen: boolean) => {
		setOpen(isOpen);
		if (!isOpen) {
			setPassword("");
		}
	};

	const defaultTrigger =
		variant === "card" ? (
			<button
				type="button"
				className="flex flex-col items-center justify-center gap-2 cursor-pointer h-full w-full border-0 bg-transparent p-0 hover:opacity-80 transition-opacity"
			>
				<Download className="h-8 w-8 text-muted-foreground" />
				<span className="text-sm font-medium text-muted-foreground">{triggerLabel ?? "Export Config"}</span>
			</button>
		) : (
			<Button variant={variant} size={size}>
				{showIcon && <Download className="h-4 w-4 mr-2" />}
				{triggerLabel ?? "Export Config"}
			</Button>
		);

	return (
		<Dialog open={open} onOpenChange={handleDialogChange}>
			<DialogTrigger asChild>{trigger ?? defaultTrigger}</DialogTrigger>
			<DialogContent>
				<form onSubmit={handleExport}>
					<DialogHeader>
						<DialogTitle>Export Full Configuration</DialogTitle>
						<DialogDescription>Export the complete Zerobyte configuration.</DialogDescription>
					</DialogHeader>

					<div className="space-y-4 py-4">
						<div className="flex items-center space-x-3">
							<Checkbox
								id="includeMetadata"
								checked={includeMetadata}
								onCheckedChange={(checked) => setIncludeMetadata(checked === true)}
							/>
							<Label htmlFor="includeMetadata" className="cursor-pointer">
								Include metadata
							</Label>
						</div>
						<p className="text-xs text-muted-foreground ml-7">
							Include database IDs, timestamps, and runtime state (status, health checks, last backup info).
						</p>

						<div className="flex items-center justify-between pt-2 border-t">
							<Label className="cursor-pointer">Secrets handling</Label>
							<Select value={secretsMode} onValueChange={(v) => setSecretsMode(v as SecretsMode)}>
								<SelectTrigger className="w-40">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="exclude">Exclude</SelectItem>
									<SelectItem value="encrypted">Keep encrypted</SelectItem>
									<SelectItem value="cleartext">Decrypt</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<p className="text-xs text-muted-foreground">
							{secretsMode === "exclude" &&
								"Sensitive fields (passwords, API keys, webhooks) will be removed from the export."}
							{secretsMode === "encrypted" &&
								"Secrets will be exported in encrypted form. Requires the same recovery key to decrypt on import."}
							{secretsMode === "cleartext" && (
								<span className="text-yellow-600">
									⚠️ Secrets will be decrypted and exported as plaintext. Keep this export secure!
								</span>
							)}
						</p>

						<div className="flex items-center space-x-3 pt-2 border-t">
							<Checkbox
								id="includeRecoveryKey"
								checked={includeRecoveryKey}
								onCheckedChange={(checked) => setIncludeRecoveryKey(checked === true)}
							/>
							<Label htmlFor="includeRecoveryKey" className="cursor-pointer">
								Include recovery key
							</Label>
						</div>
						<p className="text-xs text-muted-foreground ml-7">
							<span className="text-yellow-600 font-medium">⚠️ Security sensitive:</span> The recovery key is the master
							encryption key for all repositories. Keep this export secure and never share it.
						</p>

						<div className="flex items-center space-x-3">
							<Checkbox
								id="includePasswordHash"
								checked={includePasswordHash}
								onCheckedChange={(checked) => setIncludePasswordHash(checked === true)}
							/>
							<Label htmlFor="includePasswordHash" className="cursor-pointer">
								Include password hash
							</Label>
						</div>
						<p className="text-xs text-muted-foreground ml-7">
							Include the hashed user passwords for seamless migration. The passwords are already securely hashed
							(argon2).
						</p>

						<div className="space-y-2 pt-2 border-t">
							<Label htmlFor="export-password">Your Password</Label>
							<Input
								id="export-password"
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder="Enter your password to export"
								required
							/>
							<p className="text-xs text-muted-foreground">
								Password is required to verify your identity before exporting configuration.
							</p>
						</div>
					</div>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button type="submit" loading={exportMutation.isPending}>
							<Download className="h-4 w-4 mr-2" />
							Export
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
