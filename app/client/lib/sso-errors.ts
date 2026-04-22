import { LOGIN_ERROR_CODES, type LoginErrorCode } from "~/lib/sso-errors";

export { getLoginErrorDescription } from "~/lib/sso-errors";

const VALID_ERROR_CODES = new Set<LoginErrorCode>(LOGIN_ERROR_CODES);

export function decodeLoginError(error?: string): LoginErrorCode | null {
	if (!error) {
		return null;
	}

	const code = decodeURIComponent(error);

	if (VALID_ERROR_CODES.has(code as LoginErrorCode)) {
		return code as LoginErrorCode;
	}

	return null;
}
