export type LoginErrorCode =
	| "ACCOUNT_LINK_REQUIRED"
	| "EMAIL_NOT_VERIFIED"
	| "INVITE_REQUIRED"
	| "BANNED_USER"
	| "SSO_LOGIN_FAILED";

export function decodeLoginError(error?: string): LoginErrorCode | null {
	if (!error) {
		return null;
	}

	let decoded = "";

	try {
		decoded = decodeURIComponent(error);
	} catch {
		decoded = error;
	}

	decoded = decoded.toLowerCase().replace(/[-_\s]+/g, "_");

	if (decoded.includes("account_not_linked")) {
		return "ACCOUNT_LINK_REQUIRED";
	}

	if (decoded.includes("email_not_verified")) {
		return "EMAIL_NOT_VERIFIED";
	}

	if (decoded.includes("banned_user") || decoded.includes("banned")) {
		return "BANNED_USER";
	}

	if (
		decoded.includes("access_denied") ||
		decoded.includes("must_be_invited") ||
		decoded.includes("unable_to_create_session") ||
		decoded.includes("invite")
	) {
		return "INVITE_REQUIRED";
	}

	return "SSO_LOGIN_FAILED";
}

export function getLoginErrorDescription(errorCode: LoginErrorCode | null): string | null {
	switch (errorCode) {
		case "ACCOUNT_LINK_REQUIRED":
			return "Your account exists but is not linked to this SSO provider. Sign in with username/password first, then enable auto linking in your provider settings or contact your administrator.";
		case "EMAIL_NOT_VERIFIED":
			return "Your identity provider did not mark your email as verified.";
		case "INVITE_REQUIRED":
			return "Access is invite-only. Ask an organization admin to send you an invitation before signing in with SSO.";
		case "BANNED_USER":
			return "You have been banned from this application. Please contact support if you believe this is an error.";
		case "SSO_LOGIN_FAILED":
			return "SSO authentication failed. Please try again.";
		default:
			return null;
	}
}
