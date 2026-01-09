import { useState } from "react";
import { Shield } from "lucide-react";
import { Button } from "~/client/components/ui/button";
import { CardContent, CardDescription, CardTitle } from "~/client/components/ui/card";
import { TwoFactorSetupDialog } from "./two-factor-setup-dialog";
import { TwoFactorDisableDialog } from "./two-factor-disable-dialog";
import { BackupCodesDialog } from "./backup-codes-dialog";

type TwoFactorSectionProps = {
	twoFactorEnabled?: boolean | null;
};

export const TwoFactorSection = ({ twoFactorEnabled }: TwoFactorSectionProps) => {
	const [setupDialogOpen, setSetupDialogOpen] = useState(false);
	const [disableDialogOpen, setDisableDialogOpen] = useState(false);
	const [backupCodesDialogOpen, setBackupCodesDialogOpen] = useState(false);

	const handleSuccess = async () => {
		window.location.reload();
	};

	return (
		<>
			<div className="border-t border-border/50 bg-card-header p-6">
				<CardTitle className="flex items-center gap-2">
					<Shield className="size-5" />
					Two-Factor Authentication
				</CardTitle>
				<CardDescription className="mt-1.5">Add an extra layer of security to your account</CardDescription>
			</div>
			<CardContent className="p-6 space-y-4">
				<div className="flex items-center justify-between">
					<div className="space-y-1">
						<p className="text-sm font-medium">
							Status:&nbsp;
							{twoFactorEnabled ? (
								<span className="text-green-500">Enabled</span>
							) : (
								<span className="text-muted-foreground">Disabled</span>
							)}
						</p>
						<p className="text-xs text-muted-foreground max-w-xl">
							Two-factor authentication adds an extra layer of security by requiring a code from your authenticator app
							in addition to your password.
						</p>
					</div>
					<div className="flex gap-2">
						{!twoFactorEnabled ? (
							<Button onClick={() => setSetupDialogOpen(true)}>Enable 2FA</Button>
						) : (
							<div className="ml-2 flex flex-col @xl:flex-row gap-2">
								<Button variant="outline" onClick={() => setBackupCodesDialogOpen(true)}>
									Backup Codes
								</Button>
								<Button variant="destructive" onClick={() => setDisableDialogOpen(true)}>
									Disable 2FA
								</Button>
							</div>
						)}
					</div>
				</div>
			</CardContent>

			<TwoFactorSetupDialog open={setupDialogOpen} onOpenChange={setSetupDialogOpen} onSuccess={handleSuccess} />

			<TwoFactorDisableDialog open={disableDialogOpen} onOpenChange={setDisableDialogOpen} onSuccess={handleSuccess} />

			<BackupCodesDialog open={backupCodesDialogOpen} onOpenChange={setBackupCodesDialogOpen} />
		</>
	);
};
