import { useMutation } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	exportBackupSchedulesMutation,
	exportFullConfigMutation,
	exportNotificationDestinationsMutation,
	exportRepositoriesMutation,
	exportVolumesMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
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

export type SecretsMode = "exclude" | "encrypted" | "cleartext";

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

export type ExportEntityType = "volumes" | "repositories" | "notification-destinations" | "backup-schedules" | "full";

type ExportConfig = {
	label: string;
	labelPlural: string;
	getFilename: (id?: string | number, name?: string) => string;
};

const exportConfigs: Record<ExportEntityType, ExportConfig> = {
	volumes: {
		label: "Volume",
		labelPlural: "Volumes",
		getFilename: (id, name) => {
			const identifier = id ?? name;
			return identifier ? `volume-${identifier}-config` : "volumes-config";
		},
	},
	repositories: {
		label: "Repository",
		labelPlural: "Repositories",
		getFilename: (id, name) => {
			const identifier = id ?? name;
			return identifier ? `repository-${identifier}-config` : "repositories-config";
		},
	},
	"notification-destinations": {
		label: "Notification Destination",
		labelPlural: "Notification Destinations",
		getFilename: (id, name) => {
			const identifier = id ?? name;
			return identifier ? `notification-destination-${identifier}-config` : "notification-destinations-config";
		},
	},
	"backup-schedules": {
		label: "Backup Schedule",
		labelPlural: "Backup Schedules",
		getFilename: (id) => (id ? `backup-schedule-${id}-config` : "backup-schedules-config"),
	},
	full: {
		label: "Full Config",
		labelPlural: "Full Config",
		getFilename: () => "zerobyte-full-config",
	},
};

type BaseExportDialogProps = {
	entityType: ExportEntityType;
	name?: string;
	id?: string | number;
};

type ExportDialogWithTrigger = BaseExportDialogProps & {
	/** Custom trigger element. When provided, variant/size/triggerLabel/showIcon are ignored. */
	trigger: React.ReactNode;
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
	const [password, setPassword] = useState("");

	const config = exportConfigs[entityType];
	const isSingleItem = !!(name || id);
	const isFullExport = entityType === "full";
	// TODO: Volumes will have encrypted secrets (e.g., SMB/NFS credentials) in a future PR
	const hasSecrets = entityType !== "backup-schedules" && entityType !== "volumes";
	const entityLabel = isSingleItem ? config.label : config.labelPlural;
	const filename = config.getFilename(id, name);

	const handleExportSuccess = (data: unknown) => {
		downloadAsJson(data, filename);
		toast.success(`${entityLabel} exported successfully`);
		setOpen(false);
		setPassword("");
	};

	const handleExportError = (error: unknown) => {
		const message = error && typeof error === "object" && "error" in error
			? (error as { error: string }).error
			: "Unknown error";
		toast.error("Export failed", {
			description: message,
		});
	};

	const fullExport = useMutation({
		...exportFullConfigMutation(),
		onSuccess: handleExportSuccess,
		onError: handleExportError,
	});

	const volumesExport = useMutation({
		...exportVolumesMutation(),
		onSuccess: handleExportSuccess,
		onError: handleExportError,
	});

	const repositoriesExport = useMutation({
		...exportRepositoriesMutation(),
		onSuccess: handleExportSuccess,
		onError: handleExportError,
	});

	const notificationsExport = useMutation({
		...exportNotificationDestinationsMutation(),
		onSuccess: handleExportSuccess,
		onError: handleExportError,
	});

	const backupSchedulesExport = useMutation({
		...exportBackupSchedulesMutation(),
		onSuccess: handleExportSuccess,
		onError: handleExportError,
	});

	const getMutation = () => {
		switch (entityType) {
			case "full":
				return fullExport;
			case "volumes":
				return volumesExport;
			case "repositories":
				return repositoriesExport;
			case "notification-destinations":
				return notificationsExport;
			case "backup-schedules":
				return backupSchedulesExport;
		}
	};

	const exportMutation = getMutation();

	const handleExport = (e: React.FormEvent) => {
		e.preventDefault();
		if (!password) {
			toast.error("Password is required");
			return;
		}

		const baseBody = {
			password,
			includeIds,
			includeTimestamps,
			includeRuntimeState,
			secretsMode: hasSecrets ? secretsMode : undefined,
		};

		switch (entityType) {
			case "full":
				fullExport.mutate({
					body: {
						...baseBody,
						includeRecoveryKey,
						includePasswordHash,
					},
				});
				break;
			case "volumes":
				volumesExport.mutate({
					body: {
						...baseBody,
						id: id as number | string | undefined,
						name,
					},
				});
				break;
			case "repositories":
				repositoriesExport.mutate({
					body: {
						...baseBody,
						id: id as number | string | undefined,
						name,
					},
				});
				break;
			case "notification-destinations":
				notificationsExport.mutate({
					body: {
						...baseBody,
						id: id as number | string | undefined,
						name,
					},
				});
				break;
			case "backup-schedules":
				backupSchedulesExport.mutate({
					body: {
						...baseBody,
						id: typeof id === "number" ? id : undefined,
					},
				});
				break;
		}
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
				<span className="text-sm font-medium text-muted-foreground">
					{triggerLabel ?? `Export ${isSingleItem ? "config" : "configs"}`}
				</span>
			</button>
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
				<form onSubmit={handleExport}>
					<DialogHeader>
						<DialogTitle>Export {entityLabel}</DialogTitle>
						<DialogDescription>
							{isFullExport
								? "Export the complete Zerobyte configuration including all volumes, repositories, backup schedules, and notifications."
								: isSingleItem
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
