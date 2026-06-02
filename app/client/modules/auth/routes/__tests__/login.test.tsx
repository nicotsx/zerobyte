import { afterEach, describe, expect, test, vi } from "vitest";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent, waitFor } from "~/test/test-utils";
import { PASSKEY_LOGIN_FAILED_ERROR } from "~/lib/sso-errors";

const { mockGetLoginOptions, mockNavigate, mockPasskeySignIn } = vi.hoisted(() => ({
	mockGetLoginOptions: vi.fn(async () => ({ hasPasskeySignIn: false })),
	mockNavigate: vi.fn(async () => {}),
	mockPasskeySignIn: vi.fn(
		async (): Promise<{
			data: unknown;
			error: { code: string; message: string } | null;
		}> => ({ data: null, error: null }),
	),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();

	return {
		...actual,
		useNavigate: (() => mockNavigate) as typeof actual.useNavigate,
	};
});

vi.mock("@tanstack/react-start", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-start")>();

	return {
		...actual,
		useServerFn: (fn: unknown) => fn,
	};
});

vi.mock("~/server/lib/functions/login-options", () => ({
	getLoginOptions: mockGetLoginOptions,
}));

vi.mock("~/client/lib/auth-client", () => ({
	authClient: {
		signIn: {
			passkey: mockPasskeySignIn,
		},
	},
}));

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
	mockGetLoginOptions.mockClear();
	mockGetLoginOptions.mockResolvedValue({ hasPasskeySignIn: false });
	mockNavigate.mockClear();
	mockPasskeySignIn.mockClear();
	mockPasskeySignIn.mockResolvedValue({ data: null, error: null });
	vi.unstubAllGlobals();
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

	test("shows passkey login failure message when passkey returns the login error code", async () => {
		mockSsoProvidersRequest();

		render(<LoginPage error={"PASSKEY_LOGIN_FAILED"} />, { withSuspense: true });

		expect(
			await screen.findByText(
				"Passkey sign-in failed. If 2FA is enabled, use a passkey protected by a PIN, biometrics, or screen lock, or sign in with your password and authenticator code.",
			),
		).toBeTruthy();
	});

	test("does not show error message for invalid error codes", async () => {
		mockSsoProvidersRequest();

		render(<LoginPage error="some_random_error" />, { withSuspense: true });

		expect(await screen.findByText("Login to your account")).toBeTruthy();
		expect(screen.queryByText(inviteOnlyMessage)).toBeNull();
	});

	test("renders available SSO providers from the alternative sign-in section", async () => {
		mockSsoProvidersRequest([{ providerId: "acme", organizationSlug: "acme-org" }]);

		render(<LoginPage />, { withSuspense: true });

		expect(await screen.findByRole("button", { name: "Log in with acme" })).toBeTruthy();
	});

	test("renders passkey sign-in when an active user has a passkey", async () => {
		mockSsoProvidersRequest();
		mockGetLoginOptions.mockResolvedValue({ hasPasskeySignIn: true });

		render(<LoginPage />, { withSuspense: true });

		expect(await screen.findByRole("button", { name: "Sign in with passkey" })).toBeTruthy();
	});

	test("redirects passkey verification failures to the login error box", async () => {
		mockSsoProvidersRequest();
		mockGetLoginOptions.mockResolvedValue({ hasPasskeySignIn: true });
		mockPasskeySignIn.mockResolvedValue({
			data: null,
			error: { code: "AUTHENTICATION_FAILED", message: "Authentication failed" },
		});

		render(<LoginPage />, { withSuspense: true });

		await userEvent.click(await screen.findByRole("button", { name: "Sign in with passkey" }));

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith({
				to: "/login",
				search: {
					error: PASSKEY_LOGIN_FAILED_ERROR,
				},
			});
		});
	});

	test("redirects unauthorized passkey failures to the login error box", async () => {
		mockSsoProvidersRequest();
		mockGetLoginOptions.mockResolvedValue({ hasPasskeySignIn: true });
		mockPasskeySignIn.mockResolvedValue({
			data: null,
			error: { code: "UNAUTHORIZED", message: "Unauthorized" },
		});

		render(<LoginPage />, { withSuspense: true });

		await userEvent.click(await screen.findByRole("button", { name: "Sign in with passkey" }));

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith({
				to: "/login",
				search: {
					error: PASSKEY_LOGIN_FAILED_ERROR,
				},
			});
		});
	});

	test("preserves specific passkey login error codes", async () => {
		mockSsoProvidersRequest();
		mockGetLoginOptions.mockResolvedValue({ hasPasskeySignIn: true });
		mockPasskeySignIn.mockResolvedValue({
			data: null,
			error: { code: "ERROR_INVALID_RP_ID", message: "Auth cancelled" },
		});

		render(<LoginPage />, { withSuspense: true });

		await userEvent.click(await screen.findByRole("button", { name: "Sign in with passkey" }));

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith({
				to: "/login",
				search: {
					error: "ERROR_INVALID_RP_ID",
				},
			});
		});
	});

	test("redirects conditional passkey autofill failures to the login error box", async () => {
		mockSsoProvidersRequest();
		mockPasskeySignIn.mockResolvedValue({
			data: null,
			error: { code: "AUTHENTICATION_FAILED", message: "Authentication failed" },
		});
		vi.stubGlobal("PublicKeyCredential", {
			isConditionalMediationAvailable: vi.fn(async () => true),
		});

		render(<LoginPage />, { withSuspense: true });

		await waitFor(() => {
			expect(mockPasskeySignIn).toHaveBeenCalledWith({
				autoFill: true,
			});
			expect(mockNavigate).toHaveBeenCalledWith({
				to: "/login",
				search: {
					error: "PASSKEY_LOGIN_FAILED",
				},
			});
		});
	});

	test("ignores conditional passkey autofill cancellation", async () => {
		mockSsoProvidersRequest();
		mockPasskeySignIn.mockResolvedValue({
			data: null,
			error: { code: "AUTH_CANCELLED", message: "Authentication cancelled" },
		});
		vi.stubGlobal("PublicKeyCredential", {
			isConditionalMediationAvailable: vi.fn(async () => true),
		});

		render(<LoginPage />, { withSuspense: true });

		await waitFor(() => {
			expect(mockPasskeySignIn).toHaveBeenCalledWith({
				autoFill: true,
			});
		});
		expect(mockNavigate).not.toHaveBeenCalled();
	});

	test("hides alternative sign-in when no SSO providers or passkeys are available", async () => {
		mockSsoProvidersRequest();

		render(<LoginPage />, { withSuspense: true });

		await screen.findByText("Login to your account");
		expect(screen.queryByText("Alternative Sign-in")).toBeNull();
		expect(screen.queryByRole("button", { name: "Sign in with passkey" })).toBeNull();
	});
});
