import { useMutation } from "@tanstack/react-query";
import { Fingerprint } from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/client/components/ui/button";
import { authClient } from "~/client/lib/auth-client";
import { logger } from "~/client/lib/logger";

type PasskeySignInButtonProps = {
	onSignIn: () => Promise<void>;
};

export function PasskeySignInButton({ onSignIn }: PasskeySignInButtonProps) {
	const passkeyLoginMutation = useMutation({
		mutationFn: async () => {
			const { error } = await authClient.signIn.passkey();
			if (error) throw error;

			await onSignIn();
		},
		onError: (error) => {
			logger.error(error);
			toast.error("Passkey login failed", { description: error.message });
		},
	});

	return (
		<Button
			type="button"
			variant="outline"
			className="w-full"
			loading={passkeyLoginMutation.isPending}
			disabled={passkeyLoginMutation.isPending}
			onClick={() => passkeyLoginMutation.mutate()}
		>
			<Fingerprint className="h-4 w-4 mr-2" />
			Sign in with passkey
		</Button>
	);
}
