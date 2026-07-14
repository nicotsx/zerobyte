import { Download } from "lucide-react";
import { CardContent, CardDescription, CardTitle } from "~/client/components/ui/card";
import { RecoveryKeyDownloadDialog } from "./recovery-key-download-dialog";

type Props = {
	passwordAuthSupported: boolean;
	hasPassword: boolean;
};

export function RecoveryKeySection({ passwordAuthSupported, hasPassword }: Props) {
	return (
		<>
			<div className="border-b border-border/50 bg-card-header p-6">
				<CardTitle className="flex items-center gap-2">
					<Download className="size-5" />
					Backup Recovery Key
				</CardTitle>
				<CardDescription className="mt-1.5">
					Download the recovery key used by this organization&apos;s Restic repositories
				</CardDescription>
			</div>
			<CardContent className="p-6 space-y-4">
				<p className="text-sm text-muted-foreground max-w-2xl">
					This file contains the encryption password used by Restic to secure this organization&apos;s
					backups. Store it in a password manager or other encrypted storage. You will need it to recover
					backup data if this server becomes unavailable.
				</p>
				<RecoveryKeyDownloadDialog
					passwordAuthSupported={passwordAuthSupported}
					hasPassword={hasPassword}
				/>
			</CardContent>
		</>
	);
}
