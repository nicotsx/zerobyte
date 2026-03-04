import { describe, expect, test } from "bun:test";
import type { AuthMiddlewareContext } from "~/server/lib/auth";
import { validateSsoProviderId } from "../validate-provider-id";

function createContext(path: string, body: Record<string, unknown> = {}): AuthMiddlewareContext {
	return {
		path,
		body,
		query: {},
		headers: new Headers(),
		request: new Request(`http://localhost:3000${path}`),
		params: {},
		method: "POST",
		context: {} as AuthMiddlewareContext["context"],
	} as AuthMiddlewareContext;
}

describe("validateSsoProviderId", () => {
	test("allows non-reserved provider id", async () => {
		const ctx = createContext("/sso/register", { providerId: "acme-oidc" });

		await expect(validateSsoProviderId(ctx)).resolves.toBeUndefined();
	});

	test("rejects reserved credential provider id", async () => {
		const ctx = createContext("/sso/register", {
			providerId: "credential",
		});

		await expect(validateSsoProviderId(ctx)).rejects.toThrow("reserved");
	});

	test("rejects reserved credentials provider id case-insensitively", async () => {
		const ctx = createContext("/sso/register", {
			providerId: " Credential ",
		});

		await expect(validateSsoProviderId(ctx)).rejects.toThrow("reserved");
	});

	test("skips validation outside register endpoint", async () => {
		const ctx = createContext("/sign-in/sso", { providerId: "credential" });

		await expect(validateSsoProviderId(ctx)).resolves.toBeUndefined();
	});
});
