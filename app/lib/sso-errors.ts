export const PASSKEY_LOGIN_FAILED_ERROR = "PASSKEY_LOGIN_FAILED";

export const LOGIN_ERROR_CODES = [
	"ACCOUNT_LINK_REQUIRED",
	"EMAIL_NOT_VERIFIED",
	"INVITE_REQUIRED",
	"BANNED_USER",
	"SSO_LOGIN_FAILED",
	PASSKEY_LOGIN_FAILED_ERROR,
	"ERROR_INVALID_RP_ID",
] as const;

export type LoginErrorCode = (typeof LOGIN_ERROR_CODES)[number];

export const ACCOUNT_LINK_REQUIRED_DESCRIPTION =
	"SSO sign-in was blocked because this email already belongs to another user in this instance. Contact your administrator to resolve the account conflict. If you have an invitation to this organization, verify it from your account page before signing in with SSO.";

export function getLoginErrorDescription(errorCode: LoginErrorCode): string {
	switch (errorCode) {
		case "ACCOUNT_LINK_REQUIRED":
			return ACCOUNT_LINK_REQUIRED_DESCRIPTION;
		case "EMAIL_NOT_VERIFIED":
			return "Your identity provider did not mark your email as verified.";
		case "INVITE_REQUIRED":
			return "Access is invite-only. Ask an organization admin to send you an invitation before signing in with SSO.";
		case "BANNED_USER":
			return "You have been banned from this application. Please contact support if you believe this is an error.";

		case "SSO_LOGIN_FAILED":
			return "SSO authentication failed. Please try again.";
		case PASSKEY_LOGIN_FAILED_ERROR:
			return "Passkey sign-in failed. The passkey didn't verify your identity with a PIN, biometrics, or screen lock. Please use a verified passkey or sign in with your password.";
		case "ERROR_INVALID_RP_ID":
			return "You can only sign in with a passkey on the domain set by the BASE_URL environment variable";
	}
}
