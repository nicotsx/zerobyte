import { afterEach, expect, test } from "vitest";
import { Toaster } from "sonner";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent } from "~/test/test-utils";

afterEach(cleanup);

test("shows a helpful SSO error without exposing the provider's raw message", async () => {
	const { SsoLoginButtons } = await import("../sso-login-buttons");
	server.use(
		http.post("*/api/auth/sign-in/sso", () =>
			HttpResponse.json({ message: "private-detail: discovery request failed" }, { status: 400 }),
		),
	);
	render(
		<>
			<Toaster />
			<SsoLoginButtons providers={[{ providerId: "company" }]} />
		</>,
	);
	await userEvent.click(screen.getByRole("button", { name: "Log in with company" }));
	expect(await screen.findByText("SSO authentication failed. Please try again.")).toBeTruthy();
	expect(screen.queryByText(/private-detail/)).toBeNull();
	expect(screen.getByRole("button", { name: "Log in with company" }).hasAttribute("disabled")).toBe(false);
});
