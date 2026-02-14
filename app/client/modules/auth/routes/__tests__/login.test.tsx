import { describe, expect, mock, test } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";

mock.module("@tanstack/react-router", () => ({
	useNavigate: () => mock(() => {}),
}));

mock.module("@tanstack/react-query", () => ({
	useQuery: () => ({ data: { providers: [] as Array<{ providerId: string; organizationSlug: string }> } }),
}));

mock.module("~/client/lib/auth-client", () => ({
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

describe("LoginPage", () => {
	test("shows an invite-only message when SSO returns access_denied", async () => {
		render(<LoginPage error="access_denied" />);

		await waitFor(() => {
			expect(
				screen.getByText(
					"Access is invite-only. Ask an organization admin to send you an invitation before signing in with SSO.",
				),
			).toBeTruthy();
		});
	});
});
