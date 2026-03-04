import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "~/client/components/ui/button";
import { authClient } from "~/client/lib/auth-client";
import { getPublicSsoProvidersOptions } from "~/client/api-client/@tanstack/react-query.gen";

export function SsoLoginSection() {
	const { data: ssoProviders } = useSuspenseQuery({
		...getPublicSsoProvidersOptions(),
	});

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
			console.error(error);
			toast.error("SSO Login failed", { description: error.message });
		},
	});

	if (ssoProviders.providers.length === 0) {
		return null;
	}

	return (
		<div className="pt-4 border-t border-border/60 space-y-3">
			<p className="text-sm font-medium">Alternative Sign-in</p>
			<div className="flex flex-col gap-2">
				{ssoProviders.providers.map((provider) => (
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
			</div>
		</div>
	);
}
