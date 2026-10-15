import { authClient } from "~/client/lib/auth-client";
import { logger } from "~/client/lib/logger";
import { decodeLoginError } from "~/client/lib/sso-errors";
import { getLoginErrorDescription } from "~/lib/sso-errors";

type SsoSignInOptions = {
	providerId: string;
	callbackURL: string;
	loginHint?: string;
};

function getSsoSignInErrorMessage(error: unknown) {
	const fallback = getLoginErrorDescription("SSO_LOGIN_FAILED");
	if (!error) return fallback;
	if (typeof error !== "object") return fallback;
	if (!("code" in error)) return fallback;
	if (typeof error.code !== "string") return fallback;

	const code = decodeLoginError(error.code);
	if (!code) return fallback;

	return getLoginErrorDescription(code);
}

export async function startSsoSignIn(options: SsoSignInOptions): Promise<string> {
	try {
		const { data, error } = await authClient.signIn.sso(options);

		if (error) throw error;
		if (!data?.url) throw new Error("Missing SSO redirect URL");

		return data.url;
	} catch (cause) {
		logger.error(cause);
		throw new Error(getSsoSignInErrorMessage(cause), { cause });
	}
}
