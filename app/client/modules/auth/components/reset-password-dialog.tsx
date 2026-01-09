import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/client/components/ui/dialog";

const RESET_PASSWORD_COMMAND = "docker exec -it zerobyte bun run cli reset-password";

type ResetPasswordDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

export const ResetPasswordDialog = ({ open, onOpenChange }: ResetPasswordDialogProps) => {
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
					<div className="rounded-md bg-muted p-4 font-mono text-sm break-all select-all">{RESET_PASSWORD_COMMAND}</div>
					<p className="text-sm text-muted-foreground">
						This command will start an interactive session where you can enter a new password for your account.
					</p>
				</div>
			</DialogContent>
		</Dialog>
	);
};
