import { expect, test } from "vitest";
import { HttpResponse, http, server } from "~/test/msw/server";

test("returns the provider's redirect URL", async () => {
	const { startSsoSignIn } = await import("../start-sso-sign-in");
	server.use(
		http.post("*/api/auth/sign-in/sso", () =>
			HttpResponse.json({ url: "https://identity.example.com/authorize", redirect: false }),
		),
	);

	await expect(startSsoSignIn({ providerId: "company", callbackURL: "/settings" })).resolves.toBe(
		"https://identity.example.com/authorize",
	);
});

test("keeps provider diagnostics as the cause of a safe error", async () => {
	const { startSsoSignIn } = await import("../start-sso-sign-in");
	server.use(
		http.post("*/api/auth/sign-in/sso", () =>
			HttpResponse.json({ message: "Discovery request failed" }, { status: 400 }),
		),
	);

	await expect(startSsoSignIn({ providerId: "company", callbackURL: "/login" })).rejects.toMatchObject({
		message: "SSO authentication failed. Please try again.",
		cause: { message: "Discovery request failed" },
	});
});

test("normalizes a rejected network request and preserves its cause", async () => {
	const { startSsoSignIn } = await import("../start-sso-sign-in");
	server.use(http.post("*/api/auth/sign-in/sso", () => HttpResponse.error()));

	await expect(startSsoSignIn({ providerId: "company", callbackURL: "/login" })).rejects.toMatchObject({
		message: "SSO authentication failed. Please try again.",
		cause: expect.any(Error),
	});
});

test("rejects a successful response without a redirect URL", async () => {
	const { startSsoSignIn } = await import("../start-sso-sign-in");
	server.use(http.post("*/api/auth/sign-in/sso", () => HttpResponse.json({})));

	await expect(startSsoSignIn({ providerId: "company", callbackURL: "/login" })).rejects.toMatchObject({
		message: "SSO authentication failed. Please try again.",
		cause: { message: "Missing SSO redirect URL" },
	});
});
