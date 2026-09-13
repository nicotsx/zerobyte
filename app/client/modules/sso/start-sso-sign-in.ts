import { authClient } from "~/client/lib/auth-client";
import { logger } from "~/client/lib/logger";
import { getLoginErrorDescription } from "~/lib/sso-errors";

type SsoSignInOptions = {
	providerId: string;
	callbackURL: string;
	loginHint?: string;
};

export async function startSsoSignIn(options: SsoSignInOptions): Promise<string> {
	try {
		const { data, error } = await authClient.signIn.sso(options);

		if (error) throw error;
		if (!data?.url) throw new Error("Missing SSO redirect URL");

		return data.url;
	} catch (cause) {
		logger.error(cause);
		throw new Error(getLoginErrorDescription("SSO_LOGIN_FAILED"), { cause });
	}
}
