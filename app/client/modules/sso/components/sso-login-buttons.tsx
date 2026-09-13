import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "~/client/components/ui/button";
import { startSsoSignIn } from "../start-sso-sign-in";

type SsoProvider = {
	providerId: string;
};

type SsoLoginButtonsProps = {
	providers: SsoProvider[];
};

export function SsoLoginButtons({ providers }: SsoLoginButtonsProps) {
	const ssoLoginMutation = useMutation({
		mutationFn: (providerId: string) => startSsoSignIn({ providerId, callbackURL: "/login" }),
		onSuccess: (url) => {
			window.location.href = url;
		},
		onError: (error) => {
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
