import { describe, expect, test } from "bun:test";
import type { AuthMiddlewareContext } from "~/server/lib/auth";
import { validateSsoCallbackUrls } from "../validate-sso-callback-urls";

function createContext(
	path: string,
	body: Record<string, unknown> = {},
	query: Record<string, unknown> = {},
): AuthMiddlewareContext {
	return {
		path,
		body,
		query,
		headers: new Headers(),
		request: new Request(`http://localhost:3000${path}`),
		params: {},
		method: "POST",
		context: {} as AuthMiddlewareContext["context"],
	} as AuthMiddlewareContext;
}

describe("validateSsoCallbackUrls", () => {
	test("accepts relative paths for every callback field", async () => {
		const ctx = createContext("/sign-in/sso", {
			callbackURL: "/login",
			errorCallbackURL: "/login/error",
			newUserCallbackURL: "/download-recovery-key",
		});

		expect(validateSsoCallbackUrls(ctx)).resolves.toBeUndefined();
	});

	test("rejects https://evil.example", async () => {
		const ctx = createContext("/sign-in/sso", { callbackURL: "https://evil.example" });

		expect(validateSsoCallbackUrls(ctx)).rejects.toThrow("callbackURL");
	});

	test("rejects //evil.example", async () => {
		const ctx = createContext("/sign-in/sso", { callbackURL: "//evil.example" });

		expect(validateSsoCallbackUrls(ctx)).rejects.toThrow("callbackURL");
	});

	test("rejects /sso/callback/foo", async () => {
		const ctx = createContext("/sign-in/sso", { callbackURL: "/sso/callback/foo" });

		expect(validateSsoCallbackUrls(ctx)).rejects.toThrow("callbackURL");
	});

	test("rejects /sso/saml2/foo", async () => {
		const ctx = createContext("/sign-in/sso", { callbackURL: "/sso/saml2/foo" });

		expect(validateSsoCallbackUrls(ctx)).rejects.toThrow("callbackURL");
	});

	test("rejects malicious query callback fields", async () => {
		const ctx = createContext("/sign-in/sso", {}, { errorCallbackURL: "https://evil.example" });

		expect(validateSsoCallbackUrls(ctx)).rejects.toThrow("errorCallbackURL");
	});

	test("rejects malicious newUserCallbackURL", async () => {
		const ctx = createContext("/sign-in/sso", { newUserCallbackURL: "https://evil.example" });

		expect(validateSsoCallbackUrls(ctx)).rejects.toThrow("newUserCallbackURL");
	});

	test("skips validation outside SSO sign-in endpoint", async () => {
		const ctx = createContext("/sign-in/email", { callbackURL: "https://evil.example" });

		expect(validateSsoCallbackUrls(ctx)).resolves.toBeUndefined();
	});
});
