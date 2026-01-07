import { useMutation } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useState } from "react";
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
import { parseError } from "../lib/errors";
import { downloadFile } from "../lib/utils";

const DEFAULT_EXPORT_FILENAME = "zerobyte-full-config";

export const ExportDialog = () => {
	const [open, setOpen] = useState(false);
	const [includeMetadata, setIncludeMetadata] = useState(false);
	const [password, setPassword] = useState("");

	const exportMutation = useMutation({
		...exportFullConfigMutation(),
		onSuccess: (data) => {
			downloadFile(data, `${DEFAULT_EXPORT_FILENAME}.json`, "application/json");
			toast.success("Configuration exported successfully");
			setOpen(false);
			setPassword("");
		},
		onError: (e) => {
			toast.error("Export failed", {
				description: parseError(e)?.message,
			});
		},
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
			},
		});
	};

	const handleDialogChange = (isOpen: boolean) => {
		setOpen(isOpen);
		if (!isOpen) {
			setPassword("");
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleDialogChange}>
			<DialogTrigger asChild>
				<Button>
					<Download className="h-4 w-4 mr-2" />
					Export configuration
				</Button>
			</DialogTrigger>
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
							Include timestamps and runtime state (status, health checks, last backup info).
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
};
