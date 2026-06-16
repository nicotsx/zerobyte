import { useSuspenseQuery } from "@tanstack/react-query";
import { getPublicSsoProvidersOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { SsoLoginButtons } from "~/client/modules/sso/components/sso-login-buttons";
import { PasskeySignInButton } from "./passkey-sign-in-button";

type AlternativeSignInSectionProps = {
	hasPasskeySignIn: boolean;
	onPasskeySignIn: () => Promise<void>;
};

export function AlternativeSignInSection({ hasPasskeySignIn, onPasskeySignIn }: AlternativeSignInSectionProps) {
	const { data: ssoProviders } = useSuspenseQuery({
		...getPublicSsoProvidersOptions(),
	});

	if (ssoProviders.providers.length === 0 && !hasPasskeySignIn) {
		return null;
	}

	return (
		<div className="pt-4 border-t border-border/60 space-y-3">
			<p className="text-sm font-medium">Alternative Sign-in</p>
			<div className="flex flex-col gap-2">
				{hasPasskeySignIn && <PasskeySignInButton onSignIn={onPasskeySignIn} />}
				<SsoLoginButtons providers={ssoProviders.providers} />
			</div>
		</div>
	);
}
