export type LoginErrorCode =
	| "ACCOUNT_LINK_REQUIRED"
	| "EMAIL_NOT_VERIFIED"
	| "INVITE_REQUIRED"
	| "BANNED_USER"
	| "SSO_LOGIN_FAILED";

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

export function getLoginErrorDescription(errorCode: LoginErrorCode): string {
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
	}
}
