import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen } from "~/test/test-utils";

await mock.module("@tanstack/react-router", () => ({
	useNavigate: () => mock(() => {}),
}));

await mock.module("~/client/modules/sso/components/sso-login-section", () => ({
	SsoLoginSection: () => null,
}));

import { LoginPage } from "../login";
const inviteOnlyMessage =
	"Access is invite-only. Ask an organization admin to send you an invitation before signing in with SSO.";

afterEach(() => {
	cleanup();
});

describe("LoginPage", () => {
	test("shows an invite-only message when SSO returns INVITE_REQUIRED code", async () => {
		render(<LoginPage error="INVITE_REQUIRED" />);

		expect(await screen.findByText(inviteOnlyMessage)).toBeTruthy();
	});

	test("shows account link required message when SSO returns ACCOUNT_LINK_REQUIRED code", async () => {
		render(<LoginPage error="ACCOUNT_LINK_REQUIRED" />);

		expect(
			await screen.findByText(
				"SSO sign-in was blocked because this email already belongs to another user in this instance. Contact your administrator to resolve the account conflict.",
			),
		).toBeTruthy();
	});

	test("shows banned message when SSO returns BANNED_USER code", async () => {
		render(<LoginPage error="BANNED_USER" />);

		expect(
			await screen.findByText(
				"You have been banned from this application. Please contact support if you believe this is an error.",
			),
		).toBeTruthy();
	});

	test("shows email not verified message when SSO returns EMAIL_NOT_VERIFIED code", async () => {
		render(<LoginPage error="EMAIL_NOT_VERIFIED" />);

		expect(await screen.findByText("Your identity provider did not mark your email as verified.")).toBeTruthy();
	});

	test("shows generic SSO error message when SSO returns SSO_LOGIN_FAILED code", async () => {
		render(<LoginPage error="SSO_LOGIN_FAILED" />);

		expect(await screen.findByText("SSO authentication failed. Please try again.")).toBeTruthy();
	});

	test("does not show error message for invalid error codes", async () => {
		render(<LoginPage error="some_random_error" />);

		expect(await screen.findByText("Login to your account")).toBeTruthy();
		expect(screen.queryByText(inviteOnlyMessage)).toBeNull();
	});
});
