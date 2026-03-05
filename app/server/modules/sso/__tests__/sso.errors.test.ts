import { describe, expect, test } from "bun:test";
import { mapAuthErrorToCode } from "../sso.errors";

describe("mapAuthErrorToCode", () => {
	test("maps account-not-linked errors to ACCOUNT_LINK_REQUIRED", () => {
		expect(mapAuthErrorToCode(encodeURIComponent("account not linked"))).toBe("ACCOUNT_LINK_REQUIRED");
	});

	test("maps unable-to-link-account errors to ACCOUNT_LINK_REQUIRED", () => {
		expect(mapAuthErrorToCode(encodeURIComponent("unable to link account"))).toBe("ACCOUNT_LINK_REQUIRED");
	});

	test("maps security account-linking denial to ACCOUNT_LINK_REQUIRED", () => {
		expect(
			mapAuthErrorToCode(
				encodeURIComponent("SSO account linking is not permitted for users outside this organization"),
			),
		).toBe("ACCOUNT_LINK_REQUIRED");
	});

	test("maps invite-required errors to INVITE_REQUIRED", () => {
		expect(
			mapAuthErrorToCode(
				encodeURIComponent("Access denied. You must be invited to this organization before you can sign in with SSO."),
			),
		).toBe("INVITE_REQUIRED");
	});

	test("maps unknown errors to SSO_LOGIN_FAILED", () => {
		expect(mapAuthErrorToCode(encodeURIComponent("some random error"))).toBe("SSO_LOGIN_FAILED");
	});
});
