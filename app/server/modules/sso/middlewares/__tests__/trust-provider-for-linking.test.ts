import { beforeEach, describe, expect, test } from "vitest";
import { db } from "~/server/db/db";
import { account, member, organization, ssoProvider, usersTable, verification } from "~/server/db/schema";
import { resolveTrustedProvidersForRequest } from "../trust-provider-for-linking";
import { SSO_INVITATION_INTENT_COOKIE, ssoService } from "../../sso.service";

function randomId() {
	return Bun.randomUUIDv7();
}

function randomSlug(prefix: string) {
	return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function createRequest(path: string, cookie?: string): Request {
	return new Request(`http://test.local${path}`, { headers: cookie ? { Cookie: cookie } : undefined });
}

async function createSsoProviderRecord(providerId: string, options: { organizationId?: string; userId?: string } = {}) {
	const userId = options.userId ?? randomId();
	const organizationId = options.organizationId ?? randomId();

	if (!options.userId) {
		await db.insert(usersTable).values({
			id: userId,
			username: randomSlug("inviter"),
			email: `${randomSlug("inviter")}@example.com`,
			name: "Inviter",
		});
	}

	if (!options.organizationId) {
		await db.insert(organization).values({
			id: organizationId,
			name: "Acme",
			slug: randomSlug("acme"),
			createdAt: new Date(),
		});
	}

	await db.insert(ssoProvider).values({
		id: randomId(),
		providerId,
		organizationId,
		userId,
		issuer: "https://issuer.example.com",
		domain: "example.com",
	});

	return { organizationId, userId };
}

describe("resolveTrustedProvidersForRequest", () => {
	beforeEach(async () => {
		await db.delete(member);
		await db.delete(account);
		await db.delete(ssoProvider);
		await db.delete(verification);
		await db.delete(organization);
		await db.delete(usersTable);
	});

	test("returns [] when request is missing", async () => {
		expect(await resolveTrustedProvidersForRequest()).toEqual([]);
	});

	test("returns [] for non-callback paths", async () => {
		expect(await resolveTrustedProvidersForRequest(createRequest("/sign-in/email"))).toEqual([]);
	});

	test("returns [] for unknown providers", async () => {
		expect(await resolveTrustedProvidersForRequest(createRequest("/sso/callback/missing-provider"))).toEqual([]);
	});

	test("requires invitation confirmation even for a known provider", async () => {
		await createSsoProviderRecord("pocket-id");

		expect(await resolveTrustedProvidersForRequest(createRequest("/api/auth/sso/callback/pocket-id"))).toEqual([]);
	});

	test("trusts only the callback provider selected by a valid invitation SSO intent", async () => {
		const { organizationId, userId } = await createSsoProviderRecord("pocket-id");
		await createSsoProviderRecord("oidc-backup", { organizationId, userId });
		const token = await ssoService.createInvitationSsoIntent({
			userId: randomId(),
			invitationId: randomId(),
			providerId: "oidc-backup",
			organizationId,
			email: "alice@example.com",
		});
		const cookie = `${SSO_INVITATION_INTENT_COOKIE}=${token}`;

		expect(await resolveTrustedProvidersForRequest(createRequest("/sso/callback/pocket-id", cookie))).toEqual([]);
		expect(await resolveTrustedProvidersForRequest(createRequest("/sso/callback/oidc-backup", cookie))).toEqual([
			"oidc-backup",
		]);
	});
});
