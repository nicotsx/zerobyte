import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/client/components/ui/select";

async function verifyPassword(password: string): Promise<boolean> {
	const response = await fetch("/api/v1/auth/verify-password", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ password }),
	});
	return response.ok;
}

export type SecretsMode = "exclude" | "encrypted" | "cleartext";

export type ExportOptions = {
	includeIds?: boolean;
	includeTimestamps?: boolean;
	includeRuntimeState?: boolean;
	includeRecoveryKey?: boolean;
	includePasswordHash?: boolean;
	secretsMode?: SecretsMode;
	name?: string;
	id?: string | number;
};

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

async function exportFromApi(endpoint: string, filename: string, options: ExportOptions = {}): Promise<void> {
	const params = new URLSearchParams();
	if (options.includeIds === false) params.set("includeIds", "false");
	if (options.includeTimestamps === false) params.set("includeTimestamps", "false");
	if (options.includeRuntimeState === true) params.set("includeRuntimeState", "true");
	if (options.includeRecoveryKey === true) params.set("includeRecoveryKey", "true");
	if (options.includePasswordHash === true) params.set("includePasswordHash", "true");
	if (options.secretsMode && options.secretsMode !== "exclude") params.set("secretsMode", options.secretsMode);
	if (options.id !== undefined) params.set("id", String(options.id));
	if (options.name) params.set("name", options.name);

	const url = params.toString() ? `${endpoint}?${params}` : endpoint;
	const res = await fetch(url, { credentials: "include" });

	if (!res.ok) {
		const errorText = await res.text().catch(() => res.statusText);
		throw new Error(errorText || `HTTP ${res.status}`);
	}

	const data = await res.json();
	downloadAsJson(data, filename);
}

export type ExportEntityType = "volumes" | "repositories" | "notifications" | "backups" | "full";

type ExportConfig = {
	endpoint: string;
	label: string;
	labelPlural: string;
	getFilename: (options: ExportOptions) => string;
};

const exportConfigs: Record<ExportEntityType, ExportConfig> = {
	volumes: {
		endpoint: "/api/v1/config/export/volumes",
		label: "Volume",
		labelPlural: "Volumes",
		getFilename: (opts) => {
			const identifier = opts.id ?? opts.name;
			return identifier ? `volume-${identifier}-config` : "volumes-config";
		},
	},
	repositories: {
		endpoint: "/api/v1/config/export/repositories",
		label: "Repository",
		labelPlural: "Repositories",
		getFilename: (opts) => {
			const identifier = opts.id ?? opts.name;
			return identifier ? `repository-${identifier}-config` : "repositories-config";
		},
	},
	notifications: {
		endpoint: "/api/v1/config/export/notifications",
		label: "Notification",
		labelPlural: "Notifications",
		getFilename: (opts) => {
			const identifier = opts.id ?? opts.name;
			return identifier ? `notification-${identifier}-config` : "notifications-config";
		},
	},
	backups: {
		endpoint: "/api/v1/config/export/backups",
		label: "Backup Schedule",
		labelPlural: "Backup Schedules",
		getFilename: (opts) => (opts.id ? `backup-schedule-${opts.id}-config` : "backup-schedules-config"),
	},
	full: {
		endpoint: "/api/v1/config/export",
		label: "Full Config",
		labelPlural: "Full Config",
		getFilename: () => "zerobyte-full-config",
	},
};

export async function exportConfig(
	entityType: ExportEntityType,
	options: ExportOptions = {}
): Promise<void> {
	const config = exportConfigs[entityType];
	const filename = config.getFilename(options);
	await exportFromApi(config.endpoint, filename, options);
}

type ExportDialogProps = {
	entityType: ExportEntityType;
	name?: string;
	id?: string | number;
	trigger?: React.ReactNode;
	variant?: "default" | "outline" | "ghost" | "card";
	size?: "default" | "sm" | "lg" | "icon";
	triggerLabel?: string;
	showIcon?: boolean;
};

export function ExportDialog({
	entityType,
	name,
	id,
	trigger,
	variant = "outline",
	size = "default",
	triggerLabel,
	showIcon = true,
}: ExportDialogProps) {
	const [open, setOpen] = useState(false);
	const [includeIds, setIncludeIds] = useState(true);
	const [includeTimestamps, setIncludeTimestamps] = useState(true);
	const [includeRuntimeState, setIncludeRuntimeState] = useState(false);
	const [includeRecoveryKey, setIncludeRecoveryKey] = useState(false);
	const [includePasswordHash, setIncludePasswordHash] = useState(false);
	const [secretsMode, setSecretsMode] = useState<SecretsMode>("exclude");
	const [isExporting, setIsExporting] = useState(false);
	const [showPasswordStep, setShowPasswordStep] = useState(false);
	const [password, setPassword] = useState("");
	const [isVerifying, setIsVerifying] = useState(false);

	const config = exportConfigs[entityType];
	const isSingleItem = !!(name || id);
	const isFullExport = entityType === "full";
	// TODO: Volumes will have encrypted secrets (e.g., SMB/NFS credentials) in a future PR
	const hasSecrets = entityType !== "backups" && entityType !== "volumes";
	const entityLabel = isSingleItem ? config.label : config.labelPlural;
	const requiresPassword = includeRecoveryKey || secretsMode === "cleartext";

	const performExport = async () => {
		setIsExporting(true);
		try {
			await exportConfig(entityType, {
				includeIds,
				includeTimestamps,
				includeRuntimeState,
				includeRecoveryKey: isFullExport ? includeRecoveryKey : undefined,
				includePasswordHash: isFullExport ? includePasswordHash : undefined,
				secretsMode: hasSecrets ? secretsMode : undefined,
				name,
				id,
			});
			toast.success(`${entityLabel} exported successfully`);
			setOpen(false);
			setShowPasswordStep(false);
			setPassword("");
		} catch (err) {
			toast.error("Export failed", {
				description: err instanceof Error ? err.message : String(err),
			});
		} finally {
			setIsExporting(false);
		}
	};

	const handleExport = () => {
		if (requiresPassword) {
			setShowPasswordStep(true);
		} else {
			performExport();
		}
	};

	const handlePasswordSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!password) {
			toast.error("Password is required");
			return;
		}

		setIsVerifying(true);
		try {
			const isValid = await verifyPassword(password);
			if (!isValid) {
				toast.error("Incorrect password");
				return;
			}
			// Password verified, proceed with export
			await performExport();
		} catch {
			toast.error("Incorrect password");
		} finally {
			setIsVerifying(false);
		}
	};

	const handleDialogChange = (isOpen: boolean) => {
		setOpen(isOpen);
		if (!isOpen) {
			setShowPasswordStep(false);
			setPassword("");
		}
	};

	const defaultTrigger =
		variant === "card" ? (
			<div className="flex flex-col items-center justify-center gap-2 cursor-pointer h-full w-full">
				<Download className="h-8 w-8 text-muted-foreground" />
				<span className="text-sm font-medium text-muted-foreground">
					{triggerLabel ?? `Export ${isSingleItem ? "config" : "configs"}`}
				</span>
			</div>
		) : (
			<Button variant={variant} size={size}>
				{showIcon && <Download className="h-4 w-4 mr-2" />}
				{triggerLabel ?? `Export ${isSingleItem ? "config" : "configs"}`}
			</Button>
		);

	return (
		<Dialog open={open} onOpenChange={handleDialogChange}>
			<DialogTrigger asChild>{trigger ?? defaultTrigger}</DialogTrigger>
			<DialogContent>
				{showPasswordStep ? (
					<form onSubmit={handlePasswordSubmit}>
						<DialogHeader>
							<DialogTitle>Confirm Export</DialogTitle>
							<DialogDescription>
								For security reasons, please enter your password to export
								{includeRecoveryKey && secretsMode === "cleartext"
									? " the recovery key and decrypted secrets."
									: includeRecoveryKey
										? " the recovery key."
										: " decrypted secrets."}
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-4 py-4">
							<div className="space-y-2">
								<Label htmlFor="export-password">Your Password</Label>
								<Input
									id="export-password"
									type="password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
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
									setShowPasswordStep(false);
									setPassword("");
								}}
							>
								Back
							</Button>
							<Button type="submit" loading={isVerifying || isExporting}>
								<Download className="h-4 w-4 mr-2" />
								Export
							</Button>
						</DialogFooter>
					</form>
				) : (
					<>
						<DialogHeader>
							<DialogTitle>Export {entityLabel}</DialogTitle>
							<DialogDescription>
								{isSingleItem
									? `Export the configuration for this ${config.label.toLowerCase()}.`
									: `Export all ${config.labelPlural.toLowerCase()} configurations.`}
							</DialogDescription>
						</DialogHeader>

						<div className="space-y-4 py-4">
					<div className="flex items-center space-x-3">
						<Checkbox
							id="includeIds"
							checked={includeIds}
							onCheckedChange={(checked) => setIncludeIds(checked === true)}
						/>
						<Label htmlFor="includeIds" className="cursor-pointer">
							Include database IDs
						</Label>
					</div>
					<p className="text-xs text-muted-foreground ml-7">
						Include internal database identifiers in the export. Useful for debugging or when IDs are needed for reference.
					</p>

					<div className="flex items-center space-x-3">
						<Checkbox
							id="includeTimestamps"
							checked={includeTimestamps}
							onCheckedChange={(checked) => setIncludeTimestamps(checked === true)}
						/>
						<Label htmlFor="includeTimestamps" className="cursor-pointer">
							Include timestamps
						</Label>
					</div>
					<p className="text-xs text-muted-foreground ml-7">
						Include createdAt and updatedAt timestamps. Disable for cleaner exports when timestamps aren't needed.
					</p>

					<div className="flex items-center space-x-3">
						<Checkbox
							id="includeRuntimeState"
							checked={includeRuntimeState}
							onCheckedChange={(checked) => setIncludeRuntimeState(checked === true)}
						/>
						<Label htmlFor="includeRuntimeState" className="cursor-pointer">
							Include runtime state
						</Label>
					</div>
					<p className="text-xs text-muted-foreground ml-7">
						Include current status, health checks, and last backup information. Usually not needed for migration.
					</p>

					{hasSecrets && (
						<>
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
								{secretsMode === "exclude" && "Sensitive fields (passwords, API keys, webhooks) will be removed from the export."}
								{secretsMode === "encrypted" && "Secrets will be exported in encrypted form. Requires the same recovery key to decrypt on import."}
								{secretsMode === "cleartext" && (
									<span className="text-yellow-600">
										⚠️ Secrets will be decrypted and exported as plaintext. Keep this export secure!
									</span>
								)}
							</p>
						</>
					)}

					{isFullExport && (
						<>
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
								<span className="text-yellow-600 font-medium">⚠️ Security sensitive:</span> The recovery key is the master encryption key for all repositories. Keep this export secure and never share it.
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
								Include the hashed admin password for seamless migration. The password is already securely hashed (argon2).
							</p>
						</>
					)}
				</div>

						<DialogFooter>
							<Button variant="outline" onClick={() => setOpen(false)}>
								Cancel
							</Button>
							<Button onClick={handleExport} loading={isExporting}>
								<Download className="h-4 w-4 mr-2" />
								Export
							</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

export function ExportCard({ entityType, ...props }: Omit<ExportDialogProps, "variant" | "trigger">) {
	const config = exportConfigs[entityType];

	return (
		<ExportDialog
			entityType={entityType}
			variant="card"
			triggerLabel={props.triggerLabel ?? `Export ${props.id || props.name ? "config" : "configs"}`}
			{...props}
		/>
	);
}
