import { describe, expect, test } from "vitest";
import { betterAuth } from "better-auth";
import { hashPassword } from "better-auth/crypto";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { createApp } from "~/server/app";
import { config } from "~/server/core/config";
import { db } from "~/server/db/db";
import { account, usersTable } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "~/server/lib/auth";
import { getPasskeyOrigins } from "~/server/lib/auth/base-url";
import { authBaseURL } from "~/server/lib/auth/request-base-url";
import { createTestSession } from "~/test/helpers/auth";

const app = createApp();
const password = "upgrade-test-password";

async function createPasswordSession() {
	const session = await createTestSession();
	const username = `upgrade-${crypto.randomUUID().slice(0, 8)}`;

	await db.update(usersTable).set({ username }).where(eq(usersTable.id, session.user.id));
	await db.insert(account).values({
		id: crypto.randomUUID(),
		accountId: session.user.id,
		providerId: "credential",
		userId: session.user.id,
		password: await hashPassword(password),
	});

	return { ...session, user: { ...session.user, username } };
}

function postAuth(path: string, body: unknown, headers: Record<string, string>) {
	return app.request(`/api/auth${path}`, {
		method: "POST",
		headers: { ...headers, "Content-Type": "application/json", Origin: config.baseUrl },
		body: JSON.stringify(body),
	});
}

describe("Better Auth upgrade compatibility", () => {
	test("password sign-in creates a cookie session with organization access and sign-out revokes it", async () => {
		const { user, organizationId } = await createPasswordSession();
		const signIn = await postAuth("/sign-in/username", { username: user.username, password }, {});

		expect(signIn.status, await signIn.clone().text()).toBe(200);
		const headers = {
			Cookie: signIn.headers
				.getSetCookie()
				.map((cookie) => cookie.split(";")[0])
				.join("; "),
		};
		const session = await app.request("/api/auth/get-session", { headers });

		expect(session.status).toBe(200);
		expect(await session.json()).toMatchObject({
			user: { id: user.id },
			session: { activeOrganizationId: organizationId },
		});

		const signOut = await postAuth("/sign-out", {}, headers);

		expect(signOut.status).toBe(200);
		const revoked = await app.request("/api/auth/get-session", { headers });
		expect(await revoked.json()).toBeNull();
	});

	test("two-factor enrollment verifies a real TOTP against the stored session", async () => {
		const { headers } = await createPasswordSession();
		const enabled = await postAuth("/two-factor/enable", { password }, headers);

		expect(enabled.status).toBe(200);
		const { totpURI, backupCodes } = await enabled.json();
		expect(backupCodes).toHaveLength(5);
		const secret = new URL(totpURI).searchParams.get("secret")!;
		const code = await createOTP(base32.decode(secret)).totp();
		const verified = await postAuth("/two-factor/verify-totp", { code }, headers);

		expect(verified.status).toBe(200);
		const session = await app.request("/api/auth/get-session", {
			headers: {
				Cookie: verified.headers
					.getSetCookie()
					.map((cookie) => cookie.split(";")[0])
					.join("; "),
			},
		});

		expect(await session.json()).toMatchObject({ user: { twoFactorEnabled: true } });
	});

	test("passkey registration and sign-in options retain required user verification", async () => {
		const { headers } = await createTestSession();
		const registration = await app.request("/api/auth/passkey/generate-register-options", { headers });

		expect(registration.status).toBe(200);
		expect(await registration.json()).toMatchObject({
			rp: { id: new URL(config.baseUrl).hostname },
			authenticatorSelection: { residentKey: "required", userVerification: "required" },
		});

		const signIn = await app.request("/api/auth/passkey/generate-authenticate-options");

		expect(signIn.status).toBe(200);
		expect(await signIn.json()).toMatchObject({
			rpId: new URL(config.baseUrl).hostname,
			userVerification: "required",
		});
	});

	test("a wildcard trusted host does not prevent the application's auth instance from starting", async () => {
		const wildcardAuth = betterAuth({
			...auth.options,
			baseURL: { ...authBaseURL, allowedHosts: [...config.allowedHosts, "*.localhost"] },
		});

		const response = await wildcardAuth.handler(
			new Request(`${config.baseUrl}/api/auth/passkey/generate-authenticate-options`),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ rpId: new URL(config.baseUrl).hostname });
	});

	test("passkey origins retain exact trusted URLs without admitting wildcard siblings", () => {
		expect(
			getPasskeyOrigins([
				"https://backup.example.com/",
				"https://backup.example.com/path",
				"https://admin.example.com:8443",
				"https://*.example.com",
				"https://backup-?.example.com",
			]),
		).toEqual(["https://backup.example.com", "https://admin.example.com:8443"]);
	});
});
