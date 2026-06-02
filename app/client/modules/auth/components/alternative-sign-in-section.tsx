import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicSsoProvidersOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { SsoLoginButtons } from "~/client/modules/sso/components/sso-login-buttons";
import { getLoginOptions } from "~/server/lib/functions/login-options";
import { PasskeySignInButton } from "./passkey-sign-in-button";

type AlternativeSignInSectionProps = {
	onPasskeySignIn: () => Promise<void>;
};

export function AlternativeSignInSection({ onPasskeySignIn }: AlternativeSignInSectionProps) {
	const getOptions = useServerFn(getLoginOptions);
	const { data: ssoProviders } = useSuspenseQuery({
		...getPublicSsoProvidersOptions(),
	});
	const { data: loginOptions } = useSuspenseQuery({
		queryKey: ["login-options"],
		queryFn: getOptions,
	});

	if (ssoProviders.providers.length === 0 && !loginOptions.hasPasskeySignIn) {
		return null;
	}

	return (
		<div className="pt-4 border-t border-border/60 space-y-3">
			<p className="text-sm font-medium">Alternative Sign-in</p>
			<div className="flex flex-col gap-2">
				{loginOptions.hasPasskeySignIn && <PasskeySignInButton onSignIn={onPasskeySignIn} />}
				<SsoLoginButtons providers={ssoProviders.providers} />
			</div>
		</div>
	);
}
