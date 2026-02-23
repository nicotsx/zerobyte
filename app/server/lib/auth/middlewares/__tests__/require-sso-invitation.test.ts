import { beforeEach, describe, expect, test } from "bun:test";
import type { GenericEndpointContext } from "@better-auth/core";
import { db } from "~/server/db/db";
import { account, invitation, member, organization, ssoProvider, usersTable } from "~/server/db/schema";
import { isSsoCallbackRequest, requireSsoInvitation } from "../require-sso-invitation";

function createMockContext(path: string, params: Record<string, string> = {}): GenericEndpointContext {
	return {
		path,
		body: {},
		query: {},
		headers: new Headers(),
		request: new Request(`http://test.local${path}`),
		params,
		method: "POST",
		context: {} as GenericEndpointContext["context"],
	} as GenericEndpointContext;
}

function createMockSsoCallbackContext(providerId: string): GenericEndpointContext {
	return createMockContext(`/sso/callback/${providerId}`, { providerId });
}

function randomId() {
	return Bun.randomUUIDv7();
}

function randomSlug(prefix: string) {
	return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createSsoProvider(providerId: string) {
	const inviterId = randomId();
	const organizationId = randomId();

	await db.insert(usersTable).values({
		id: inviterId,
		username: randomSlug("inviter"),
		email: `${randomSlug("inviter")}@example.com`,
		name: "Inviter",
	});

	await db.insert(organization).values({
		id: organizationId,
		name: "Acme",
		slug: randomSlug("acme"),
		createdAt: new Date(),
	});

	await db.insert(ssoProvider).values({
		id: randomId(),
		providerId,
		organizationId,
		userId: inviterId,
		issuer: "https://issuer.example.com",
		domain: "example.com",
	});

	return { inviterId, organizationId };
}

describe("requireSsoInvitation", () => {
	beforeEach(async () => {
		await db.delete(member);
		await db.delete(account);
		await db.delete(invitation);
		await db.delete(ssoProvider);
		await db.delete(organization);
		await db.delete(usersTable);
	});

	test("throws when context is null", async () => {
		await createSsoProvider("oidc-acme");

		expect(requireSsoInvitation("user@example.com", null)).rejects.toThrow("Missing SSO context");
	});

	test("throws when request is not an SSO callback", async () => {
		await createSsoProvider("oidc-acme");

		const ctx = createMockContext("/sign-up/email");
		expect(requireSsoInvitation("user@example.com", ctx)).rejects.toThrow("Missing providerId");
	});

	test("detects whether current request is an SSO callback", async () => {
		expect(isSsoCallbackRequest(null)).toBe(false);

		const nonSsoResult = isSsoCallbackRequest(createMockContext("/sign-up/email"));
		expect(nonSsoResult).toBe(false);

		const ssoResult = isSsoCallbackRequest(createMockSsoCallbackContext("oidc-acme"));
		expect(ssoResult).toBe(true);
	});

	test("blocks SSO callback when no pending invitation exists", async () => {
		await createSsoProvider("oidc-acme");

		const ctx = createMockSsoCallbackContext("oidc-acme");
		expect(requireSsoInvitation("user@example.com", ctx)).rejects.toThrow("must be invited");
	});

	test("blocks SSO callback when invitation is expired", async () => {
		const { inviterId, organizationId } = await createSsoProvider("oidc-acme");

		await db.insert(invitation).values({
			id: randomId(),
			organizationId,
			email: "user@example.com",
			role: "member",
			status: "pending",
			expiresAt: new Date(Date.now() - 1_000),
			createdAt: new Date(),
			inviterId,
		});

		const ctx = createMockSsoCallbackContext("oidc-acme");
		expect(requireSsoInvitation("user@example.com", ctx)).rejects.toThrow("must be invited");
	});

	test("allows SSO callback when a matching pending invitation exists", async () => {
		const { inviterId, organizationId } = await createSsoProvider("oidc-acme");

		await db.insert(invitation).values({
			id: randomId(),
			organizationId,
			email: "user@example.com",
			role: "member",
			status: "pending",
			expiresAt: new Date(Date.now() + 60 * 60 * 1000),
			createdAt: new Date(),
			inviterId,
		});

		const ctx = createMockSsoCallbackContext("oidc-acme");
		expect(requireSsoInvitation("  USER@EXAMPLE.COM  ", ctx)).resolves.toBeUndefined();
	});

	test("throws when provider is not registered", async () => {
		const ctx = createMockSsoCallbackContext("missing-provider");
		expect(requireSsoInvitation("user@example.com", ctx)).rejects.toThrow("SSO provider not found");
	});
});
