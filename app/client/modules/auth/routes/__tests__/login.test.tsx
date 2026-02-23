import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
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

const createTestQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const inviteOnlyMessage =
	"Access is invite-only. Ask an organization admin to send you an invitation before signing in with SSO.";

describe("LoginPage", () => {
	test("shows an invite-only message when SSO returns access_denied", async () => {
		const queryClient = createTestQueryClient();
		render(
			<QueryClientProvider client={queryClient}>
				<LoginPage error="access_denied" />
			</QueryClientProvider>,
		);

		expect(await screen.findByText(inviteOnlyMessage)).toBeTruthy();
	});

	test("shows an invite-only message for URL-encoded invitation errors", async () => {
		const queryClient = createTestQueryClient();
		render(
			<QueryClientProvider client={queryClient}>
				<LoginPage error="must%20be%20invited" />
			</QueryClientProvider>,
		);

		expect(await screen.findByText(inviteOnlyMessage)).toBeTruthy();
	});
});
