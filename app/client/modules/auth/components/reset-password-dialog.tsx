import { toast } from "sonner";
import { Button } from "~/client/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/client/components/ui/dialog";
import { copyToClipboard } from "~/utils/clipboard";

const RESET_PASSWORD_COMMAND = "docker exec -it zerobyte bun run cli reset-password";

type ResetPasswordDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

export const ResetPasswordDialog = ({ open, onOpenChange }: ResetPasswordDialogProps) => {
	const handleCopy = async () => {
		await copyToClipboard(RESET_PASSWORD_COMMAND);
		toast.success("Command copied to clipboard");
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Reset your password</DialogTitle>
					<DialogDescription>
						To reset your password, run the following command on the server where Zerobyte is installed.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<div className="rounded-md bg-muted p-4 font-mono text-sm break-all">{RESET_PASSWORD_COMMAND}</div>
					<p className="text-sm text-muted-foreground">
						This command will start an interactive session where you can enter a new password for your account.
					</p>
					<Button onClick={handleCopy} variant="outline" className="w-full">
						Copy Command
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
};
