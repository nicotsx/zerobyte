import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Fingerprint } from "lucide-react";
import { Button } from "~/client/components/ui/button";
import { authClient } from "~/client/lib/auth-client";
import { logger } from "~/client/lib/logger";

type PasskeySignInButtonProps = {
	onSignIn: () => Promise<void>;
};

export function PasskeySignInButton({ onSignIn }: PasskeySignInButtonProps) {
	const navigate = useNavigate();
	const passkeyLoginMutation = useMutation({
		mutationFn: async () => {
			const { error } = await authClient.signIn.passkey();
			if (error) throw error;

			await onSignIn();
		},
		onError: (error) => {
			logger.error(error);

			let errorCode: string | undefined = undefined;

			if ("code" in error && typeof error.code === "string") {
				errorCode = error.code;
				if (error.code === "AUTHENTICATION_FAILED") {
					errorCode = "PASSKEY_LOGIN_FAILED";
				}
			}

			void navigate({
				to: "/login",
				search: {
					error: errorCode,
				},
			});
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
