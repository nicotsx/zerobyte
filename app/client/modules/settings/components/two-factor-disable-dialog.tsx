import { useState } from "react";
import { toast } from "sonner";
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

type TwoFactorDisableDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess: () => void;
};

export const TwoFactorDisableDialog = ({ open, onOpenChange, onSuccess }: TwoFactorDisableDialogProps) => {
	const [password, setPassword] = useState("");
	const [isDisabling, setIsDisabling] = useState(false);

	const handleDisable = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!password) {
			toast.error("Password is required");
			return;
		}

		const { error } = await authClient.twoFactor.disable({
			password,
			fetchOptions: {
				onRequest: () => {
					setIsDisabling(true);
				},
				onResponse: () => {
					setIsDisabling(false);
				},
			},
		});

		if (error) {
			console.error(error);
			toast.error("Failed to disable 2FA", { description: error.message });
			return;
		}

		toast.success("Two-factor authentication disabled successfully");
		handleClose();
		onSuccess();
	};

	const handleClose = () => {
		onOpenChange(false);
		setPassword("");
	};

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent>
				<form onSubmit={handleDisable}>
					<DialogHeader>
						<DialogTitle>Disable Two-Factor Authentication</DialogTitle>
						<DialogDescription>
							Are you sure you want to disable 2FA? Your account will be less secure. Enter your password to confirm.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<div className="space-y-2">
							<Label htmlFor="disable-password">Your password</Label>
							<Input
								id="disable-password"
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder="Enter your password"
								required
							/>
						</div>
					</div>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={handleClose}>
							Cancel
						</Button>
						<Button type="submit" variant="destructive" loading={isDisabling}>
							Disable 2FA
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};
