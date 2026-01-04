import { toast } from "sonner";
import { Button } from "~/client/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/client/components/ui/dialog";
import { copyToClipboard } from "~/utils/clipboard";

const RESET_2FA_COMMAND = "docker exec -it zerobyte bun run cli 2fa disable -u <username>";

type Reset2faDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

export const Reset2faDialog = ({ open, onOpenChange }: Reset2faDialogProps) => {
	const handleCopy = async () => {
		await copyToClipboard(RESET_2FA_COMMAND);
		toast.success("Command copied to clipboard");
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Reset Two-Factor Authentication</DialogTitle>
					<DialogDescription>
						Lost access to your authenticator app? Run the following command on the server where Zerobyte is installed
						to disable 2FA for your account.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<div className="rounded-md bg-muted p-4 font-mono text-sm break-all">{RESET_2FA_COMMAND}</div>
					<p className="text-sm text-muted-foreground">
						Replace <code className="bg-muted px-1 rounded">&lt;username&gt;</code> with your actual username. After
						running this command, you'll be able to log in without 2FA and can set it up again from settings.
					</p>
					<Button onClick={handleCopy} variant="outline" className="w-full">
						Copy Command
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
};
