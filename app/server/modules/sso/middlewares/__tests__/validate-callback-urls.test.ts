import { describe, expect, test } from "vitest";
import type { AuthMiddlewareContext } from "~/server/lib/auth";
import { validateSsoCallbackUrls } from "../validate-callback-urls";

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

		await expect(validateSsoCallbackUrls(ctx)).resolves.toBeUndefined();
	});

	test("rejects https://evil.example", async () => {
		const ctx = createContext("/sign-in/sso", {
			callbackURL: "https://evil.example",
		});

		await expect(validateSsoCallbackUrls(ctx)).rejects.toThrow("callbackURL");
	});

	test("rejects //evil.example", async () => {
		const ctx = createContext("/sign-in/sso", {
			callbackURL: "//evil.example",
		});

		await expect(validateSsoCallbackUrls(ctx)).rejects.toThrow("callbackURL");
	});

	test("rejects /sso/callback/foo", async () => {
		const ctx = createContext("/sign-in/sso", {
			callbackURL: "/sso/callback/foo",
		});

		await expect(validateSsoCallbackUrls(ctx)).rejects.toThrow("callbackURL");
	});

	test("rejects /sso/saml2/foo", async () => {
		const ctx = createContext("/sign-in/sso", {
			callbackURL: "/sso/saml2/foo",
		});

		await expect(validateSsoCallbackUrls(ctx)).rejects.toThrow("callbackURL");
	});

	test("rejects malicious query callback fields", async () => {
		const ctx = createContext("/sign-in/sso", {}, { errorCallbackURL: "https://evil.example" });

		await expect(validateSsoCallbackUrls(ctx)).rejects.toThrow("errorCallbackURL");
	});

	test("rejects malicious newUserCallbackURL", async () => {
		const ctx = createContext("/sign-in/sso", {
			newUserCallbackURL: "https://evil.example",
		});

		await expect(validateSsoCallbackUrls(ctx)).rejects.toThrow("newUserCallbackURL");
	});

	test("skips validation outside SSO sign-in endpoint", async () => {
		const ctx = createContext("/sign-in/email", {
			callbackURL: "https://evil.example",
		});

		await expect(validateSsoCallbackUrls(ctx)).resolves.toBeUndefined();
	});

	test("rejects URL-encoded external URL (%2F%2Fevil.example)", async () => {
		const ctx = createContext("/sign-in/sso", {
			callbackURL: "%2F%2Fevil.example",
		});

		await expect(validateSsoCallbackUrls(ctx)).rejects.toThrow("callbackURL");
	});

	test("rejects URL-encoded reserved path (%2Fsso%2Fcallback%2Ffoo)", async () => {
		const ctx = createContext("/sign-in/sso", {
			callbackURL: "%2Fsso%2Fcallback%2Ffoo",
		});

		await expect(validateSsoCallbackUrls(ctx)).rejects.toThrow("callbackURL");
	});

	test("rejects invalid URL encoding (malformed)", async () => {
		const ctx = createContext("/sign-in/sso", { callbackURL: "%ZZ" });

		await expect(validateSsoCallbackUrls(ctx)).rejects.toThrow("callbackURL");
	});
});
