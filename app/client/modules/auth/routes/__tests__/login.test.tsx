import { afterEach, describe, expect, test, vi } from "vitest";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen } from "~/test/test-utils";

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();

	return {
		...actual,
		useNavigate: (() => vi.fn(async () => {})) as typeof actual.useNavigate,
	};
});

import { LoginPage } from "../login";
const inviteOnlyMessage =
	"Access is invite-only. Ask an organization admin to send you an invitation before signing in with SSO.";

const mockSsoProvidersRequest = (
	providers: Array<{
		providerId: string;
		organizationSlug: string;
	}> = [],
) => {
	server.use(
		http.get("/api/v1/auth/sso-providers", () => {
			return HttpResponse.json({ providers });
		}),
	);
};

afterEach(() => {
	cleanup();
});

describe("LoginPage", () => {
	test("shows an invite-only message when SSO returns INVITE_REQUIRED code", async () => {
		mockSsoProvidersRequest();

		render(<LoginPage error="INVITE_REQUIRED" />, { withSuspense: true });

		expect(await screen.findByText(inviteOnlyMessage)).toBeTruthy();
	});

	test("shows account link required message when SSO returns ACCOUNT_LINK_REQUIRED code", async () => {
		mockSsoProvidersRequest();

		render(<LoginPage error="ACCOUNT_LINK_REQUIRED" />, { withSuspense: true });

		expect(
			await screen.findByText(
				"SSO sign-in was blocked because this email already belongs to another user in this instance. Contact your administrator to resolve the account conflict.",
			),
		).toBeTruthy();
	});

	test("shows banned message when SSO returns BANNED_USER code", async () => {
		mockSsoProvidersRequest();

		render(<LoginPage error="BANNED_USER" />, { withSuspense: true });

		expect(
			await screen.findByText(
				"You have been banned from this application. Please contact support if you believe this is an error.",
			),
		).toBeTruthy();
	});

	test("shows email not verified message when SSO returns EMAIL_NOT_VERIFIED code", async () => {
		mockSsoProvidersRequest();

		render(<LoginPage error="EMAIL_NOT_VERIFIED" />, { withSuspense: true });

		expect(await screen.findByText("Your identity provider did not mark your email as verified.")).toBeTruthy();
	});

	test("shows generic SSO error message when SSO returns SSO_LOGIN_FAILED code", async () => {
		mockSsoProvidersRequest();

		render(<LoginPage error="SSO_LOGIN_FAILED" />, { withSuspense: true });

		expect(await screen.findByText("SSO authentication failed. Please try again.")).toBeTruthy();
	});

	test("does not show error message for invalid error codes", async () => {
		mockSsoProvidersRequest();

		render(<LoginPage error="some_random_error" />, { withSuspense: true });

		expect(await screen.findByText("Login to your account")).toBeTruthy();
		expect(screen.queryByText(inviteOnlyMessage)).toBeNull();
	});

	test("renders available SSO providers from the real SSO section", async () => {
		mockSsoProvidersRequest([{ providerId: "acme", organizationSlug: "acme-org" }]);

		render(<LoginPage />, { withSuspense: true });

		expect(await screen.findByRole("button", { name: "Log in with acme" })).toBeTruthy();
	});
});
