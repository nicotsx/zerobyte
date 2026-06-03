import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "~/client/components/ui/button";
import { authClient } from "~/client/lib/auth-client";
import { logger } from "~/client/lib/logger";

type SsoProvider = {
	providerId: string;
};

type SsoLoginButtonsProps = {
	providers: SsoProvider[];
};

export function SsoLoginButtons({ providers }: SsoLoginButtonsProps) {
	const ssoLoginMutation = useMutation({
		mutationFn: async (providerId: string) => {
			const callbackPath = "/login";
			const { data, error } = await authClient.signIn.sso({
				providerId: providerId,
				callbackURL: callbackPath,
				errorCallbackURL: "/api/v1/auth/login-error",
			});
			if (error) throw error;

			return data;
		},
		onSuccess: (data) => {
			window.location.href = data.url;
		},
		onError: (error) => {
			logger.error(error);
			toast.error("SSO Login failed", { description: error.message });
		},
	});

	return (
		<>
			{providers.map((provider) => (
				<Button
					key={provider.providerId}
					type="button"
					variant="outline"
					className="w-full"
					loading={ssoLoginMutation.isPending}
					disabled={ssoLoginMutation.isPending}
					onClick={() => ssoLoginMutation.mutate(provider.providerId)}
				>
					Log in with {provider.providerId}
				</Button>
			))}
		</>
	);
}
