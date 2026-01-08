import { useState } from "react";
import { toast } from "sonner";
import { Copy, RefreshCw } from "lucide-react";
import { Button } from "~/client/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/client/components/ui/dialog";
import { Input } from "~/client/components/ui/input";
import { Label } from "~/client/components/ui/label";
import { authClient } from "~/client/lib/auth-client";
import { copyToClipboard } from "~/utils/clipboard";

type BackupCodesDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

export const BackupCodesDialog = ({ open, onOpenChange }: BackupCodesDialogProps) => {
	const [password, setPassword] = useState("");
	const [backupCodes, setBackupCodes] = useState<string[]>([]);
	const [isGenerating, setIsGenerating] = useState(false);

	const handleGenerate = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!password) {
			toast.error("Password is required");
			return;
		}

		const { data, error } = await authClient.twoFactor.generateBackupCodes({
			password,
			fetchOptions: {
				onRequest: () => {
					setIsGenerating(true);
				},
				onResponse: () => {
					setIsGenerating(false);
				},
			},
		});

		if (error) {
			console.error(error);
			toast.error("Failed to generate backup codes", { description: error.message });
			return;
		}

		setBackupCodes(data.backupCodes);
		setPassword("");
		toast.success("New backup codes generated successfully");
	};

	const handleClose = () => {
		onOpenChange(false);
		setTimeout(() => {
			setBackupCodes([]);
			setPassword("");
		}, 200);
	};

	const copyAllBackupCodes = () => {
		const text = backupCodes.join("\n");
		void copyToClipboard(text);
	};

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Backup Codes</DialogTitle>
					<DialogDescription>
						Use these codes to access your account if you lose access to your authenticator app. Each code can only be
						used once.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4 py-4">
					{backupCodes.length > 0 ? (
						<>
							<div className="p-3 bg-muted rounded-md space-y-1 max-h-48 overflow-y-auto">
								{backupCodes.map((code) => (
									<div key={code} className="text-sm font-mono flex items-center justify-between">
										<span>{code}</span>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onClick={() => copyToClipboard(code)}
											className="h-8 w-8 p-0"
										>
											<Copy className="h-4 w-4" />
										</Button>
									</div>
								))}
							</div>
							<Button type="button" variant="outline" onClick={copyAllBackupCodes} className="w-full">
								<Copy className="h-4 w-4 mr-2" />
								Copy all
							</Button>
						</>
					) : (
						<form onSubmit={handleGenerate} className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="backup-codes-password">Your password</Label>
								<Input
									id="backup-codes-password"
									type="password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									placeholder="Enter your password"
									required
								/>
							</div>
							<Button type="submit" loading={isGenerating} className="w-full">
								<RefreshCw className="h-4 w-4 mr-2" />
								Generate new codes
							</Button>
						</form>
					)}
				</div>
				<DialogFooter>
					<Button type="button" onClick={handleClose}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
