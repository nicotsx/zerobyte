import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "~/server/app";
import { account, invitation, member, organization, ssoProvider, usersTable } from "~/server/db/schema";
import { db } from "~/server/db/db";

const app = createApp();

describe("auth SSO sign-in security", () => {
	beforeEach(async () => {
		await db.delete(member);
		await db.delete(account);
		await db.delete(invitation);
		await db.delete(ssoProvider);
		await db.delete(organization);
		await db.delete(usersTable);
	});

	test("rejects malicious callback URL", async () => {
		const response = await app.request("/api/auth/sign-in/sso", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				providerId: "missing-provider",
				callbackURL: "https://evil.example",
			}),
		});

		expect(response.status).toBe(400);

		const body = await response.json();
		expect(body.code).toContain("CALLBACKURL");
		expect(body.message).toContain("callbackURL");
	});

	test("rejects malicious error callback URL", async () => {
		const response = await app.request("/api/auth/sign-in/sso", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				providerId: "missing-provider",
				callbackURL: "/login",
				errorCallbackURL: "https://evil.example",
			}),
		});

		expect(response.status).toBe(400);

		const body = await response.json();
		expect(body.code).toContain("ERRORCALLBACKURL");
		expect(body.message).toContain("errorCallbackURL");
	});

	test("rejects malicious new user callback URL", async () => {
		const response = await app.request("/api/auth/sign-in/sso", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				providerId: "missing-provider",
				callbackURL: "/login",
				newUserCallbackURL: "https://evil.example",
			}),
		});

		expect(response.status).toBe(400);

		const body = await response.json();
		expect(body.code).toContain("NEWUSERCALLBACKURL");
		expect(body.message).toContain("newUserCallbackURL");
	});

	test("allows relative callback URL to continue normal flow", async () => {
		const response = await app.request("/api/auth/sign-in/sso", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				providerId: "missing-provider",
				callbackURL: "/login",
			}),
		});

		expect(response.status).toBe(404);

		const body = await response.json();
		expect(body.code).toBe("NO_PROVIDER_FOUND_FOR_THE_ISSUER");
	});
});
