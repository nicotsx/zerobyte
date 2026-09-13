import { expect, test } from "vitest";
import { Hono } from "hono";
import { config } from "~/server/core/config";
import { createApp } from "~/server/app";
import { handleAuthCallbackErrors } from "../handle-auth-callback-errors";

test.each([
	["GET", "/api/auth/sso/callback/provider", '{"code":"INVITE_REQUIRED"}', "INVITE_REQUIRED"],
	["GET", "/api/auth/sso/callback/provider/", '{"code":"INVITE_REQUIRED"}', "INVITE_REQUIRED"],
	["GET", "/api/auth/sso/callback", '{"message":"account not linked"}', "ACCOUNT_LINK_REQUIRED"],
	["POST", "/api/auth/sso/saml2/callback/provider", '{"code":"BANNED_USER"}', "BANNED_USER"],
	["POST", "/api/auth/sso/saml2/sp/acs/provider", '{"code":"BANNED_USER"}', "BANNED_USER"],
	["GET", "/api/auth/callback/provider", '{"message":"database credentials: private-detail"}', "SSO_LOGIN_FAILED"],
	["GET", "/api/auth/sso/callback/provider", "private-detail: not JSON", "SSO_LOGIN_FAILED"],
	["GET", "/api/auth/sso/callback/provider", "null", "SSO_LOGIN_FAILED"],
])("%s %s sends a safe login error and preserves cookie cleanup", async (method, path, body, code) => {
	const app = new Hono();
	app.use("*", handleAuthCallbackErrors);
	app.all(
		"*",
		() =>
			new Response(body, {
				status: 403,
				headers: {
					"content-type": "application/json",
					"content-length": String(body.length),
					"set-cookie": "auth-state=; Max-Age=0; Path=/; HttpOnly",
				},
			}),
	);

	const response = await app.request(path, { method });
	expect(response.status).toBe(303);
	expect(response.headers.get("location")).toBe(`${config.baseUrl}/login?error=${code}`);
	expect(response.headers.get("set-cookie")).toContain("auth-state=; Max-Age=0");
	expect(response.headers.get("cache-control")).toBe("no-store");
	expect(response.headers.get("content-length")).toBeNull();
	expect(await response.text()).toBe("");
});

test("unexpected callback exceptions become safe login errors", async () => {
	const app = new Hono();
	app.use("*", handleAuthCallbackErrors);
	app.get("*", () => {
		throw new Error("private-detail");
	});
	app.onError((error, c) => c.json({ message: error.message }, 500));
	const response = await app.request("/api/auth/sso/callback/provider");
	expect(response.status).toBe(303);
	expect(response.headers.get("location")).toBe(`${config.baseUrl}/login?error=SSO_LOGIN_FAILED`);
	expect(await response.text()).toBe("");
});

test.each([
	["/api/auth/sign-in/email", 401, '{"message":"Invalid credentials"}', null],
	["/api/auth/sso/register", 400, '{"message":"Invalid provider"}', null],
	["/api/auth/sso/callback/provider", 302, "", "/settings"],
])("preserves API errors and successful redirects: %s", async (path, status, body, location) => {
	const app = new Hono();
	app.use("*", handleAuthCallbackErrors);
	app.all("*", () => new Response(body, { status, headers: location ? { location } : undefined }));
	const response = await app.request(path);
	expect(response.status).toBe(status);
	expect(response.headers.get("location")).toBe(location);
	expect(await response.text()).toBe(body);
});

test("Better Auth's default error page uses the application's safe messages", async () => {
	const app = createApp();
	const redirect = await app.request("/api/auth/error?error=INVITE_REQUIRED&error_description=private-detail", {
		headers: { origin: config.baseUrl },
	});
	expect(redirect.status).toBe(302);
	expect(redirect.headers.get("access-control-allow-origin")).toBe(config.baseUrl);
	expect(redirect.headers.get("location")).toBe(
		`${config.baseUrl}/api/v1/auth/login-error?error=INVITE_REQUIRED&error_description=private-detail`,
	);
	expect(await redirect.text()).toBe("");

	const response = await app.request(redirect.headers.get("location")!);
	expect(response.status).toBe(303);
	expect(response.headers.get("location")).toBe(`${config.baseUrl}/login?error=INVITE_REQUIRED`);
	expect(response.headers.get("cache-control")).toBe("no-store");
	expect(await response.text()).toBe("");
});

test("an expired OIDC callback ends at the safe login page", async () => {
	const app = createApp();
	let response = await app.request("/api/auth/sso/callback/provider?code=expired&state=expired");
	for (let redirects = 0; redirects < 3; redirects++) {
		const location = response.headers.get("location");
		expect(location).toBeTruthy();
		if (new URL(location!, config.baseUrl).pathname === "/login") break;
		response = await app.request(new URL(location!, config.baseUrl).toString());
	}
	expect(response.headers.get("location")).toBe(`${config.baseUrl}/login?error=SSO_LOGIN_FAILED`);
	expect(await response.text()).toBe("");
});
