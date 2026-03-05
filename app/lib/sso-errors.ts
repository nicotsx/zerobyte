export const LOGIN_ERROR_CODES = [
	"ACCOUNT_LINK_REQUIRED",
	"EMAIL_NOT_VERIFIED",
	"INVITE_REQUIRED",
	"BANNED_USER",
	"SSO_LOGIN_FAILED",
] as const;

export type LoginErrorCode = (typeof LOGIN_ERROR_CODES)[number];

export function getLoginErrorDescription(errorCode: LoginErrorCode): string {
	switch (errorCode) {
		case "ACCOUNT_LINK_REQUIRED":
			return "SSO sign-in was blocked because this email already belongs to another user in this instance. Contact your administrator to resolve the account conflict.";
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
