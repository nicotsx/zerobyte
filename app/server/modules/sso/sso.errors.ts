import type { LoginErrorCode } from "~/lib/sso-errors";

const INVITE_REQUIRED_ERRORS = new Set([
	"Access denied. You must be invited to this organization before you can sign in with SSO.",
	"SSO sign-in is invite-only for this organization",
	"unable to create session",
]);

export function mapAuthErrorToCode(error: string): LoginErrorCode {
	let decoded: string;

	try {
		decoded = decodeURIComponent(error);
	} catch {
		return "SSO_LOGIN_FAILED";
	}

	if (decoded === "account not linked") {
		return "ACCOUNT_LINK_REQUIRED";
	}

	if (decoded === "EMAIL_NOT_VERIFIED") {
		return "EMAIL_NOT_VERIFIED";
	}

	if (decoded === "banned") {
		return "BANNED_USER";
	}

	if (INVITE_REQUIRED_ERRORS.has(decoded)) {
		return "INVITE_REQUIRED";
	}

	return "SSO_LOGIN_FAILED";
}
