import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

await mock.module("@tanstack/react-router", () => ({
	useNavigate: () => mock(() => {}),
}));

await mock.module("~/client/api-client/@tanstack/react-query.gen", () => ({
	getPublicSsoProvidersOptions: () => ({
		queryKey: ["public-sso-providers"],
		queryFn: async () => ({ providers: [] }),
	}),
}));

await mock.module("~/client/lib/auth-client", () => ({
	authClient: {
		getSession: mock(async () => ({ data: null })),
		signIn: {
			username: mock(async () => ({ data: null, error: null })),
			sso: mock(async () => ({ data: null, error: null })),
		},
		twoFactor: {
			verifyTotp: mock(async () => ({ data: null, error: null })),
		},
	},
}));

import { LoginPage } from "../login";

const createTestQueryClient = () =>
	new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				gcTime: Infinity,
			},
			mutations: {
				gcTime: Infinity,
			},
		},
	});
const inviteOnlyMessage =
	"Access is invite-only. Ask an organization admin to send you an invitation before signing in with SSO.";

afterEach(() => {
	cleanup();
});

describe("LoginPage", () => {
	test("shows an invite-only message when SSO returns INVITE_REQUIRED code", async () => {
		const queryClient = createTestQueryClient();
		render(
			<QueryClientProvider client={queryClient}>
				<LoginPage error="INVITE_REQUIRED" />
			</QueryClientProvider>,
		);

		expect(await screen.findByText(inviteOnlyMessage)).toBeTruthy();
	});

	test("shows account link required message when SSO returns ACCOUNT_LINK_REQUIRED code", async () => {
		const queryClient = createTestQueryClient();
		render(
			<QueryClientProvider client={queryClient}>
				<LoginPage error="ACCOUNT_LINK_REQUIRED" />
			</QueryClientProvider>,
		);

		expect(
			await screen.findByText(
				"Your account exists but is not linked to this SSO provider. Sign in with username/password first, then enable auto linking in your provider settings or contact your administrator.",
			),
		).toBeTruthy();
	});

	test("shows banned message when SSO returns BANNED_USER code", async () => {
		const queryClient = createTestQueryClient();
		render(
			<QueryClientProvider client={queryClient}>
				<LoginPage error="BANNED_USER" />
			</QueryClientProvider>,
		);

		expect(
			await screen.findByText(
				"You have been banned from this application. Please contact support if you believe this is an error.",
			),
		).toBeTruthy();
	});

	test("shows email not verified message when SSO returns EMAIL_NOT_VERIFIED code", async () => {
		const queryClient = createTestQueryClient();
		render(
			<QueryClientProvider client={queryClient}>
				<LoginPage error="EMAIL_NOT_VERIFIED" />
			</QueryClientProvider>,
		);

		expect(await screen.findByText("Your identity provider did not mark your email as verified.")).toBeTruthy();
	});

	test("shows generic SSO error message when SSO returns SSO_LOGIN_FAILED code", async () => {
		const queryClient = createTestQueryClient();
		render(
			<QueryClientProvider client={queryClient}>
				<LoginPage error="SSO_LOGIN_FAILED" />
			</QueryClientProvider>,
		);

		expect(await screen.findByText("SSO authentication failed. Please try again.")).toBeTruthy();
	});

	test("does not show error message for invalid error codes", async () => {
		const queryClient = createTestQueryClient();
		render(
			<QueryClientProvider client={queryClient}>
				<LoginPage error="some_random_error" />
			</QueryClientProvider>,
		);

		expect(await screen.findByText("Login to your account")).toBeTruthy();
		expect(screen.queryByText(inviteOnlyMessage)).toBeNull();
	});
});
