import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/db";
import { account, member, organization, ssoProvider, usersTable } from "~/server/db/schema";
import { resolveTrustedProvidersForRequest } from "../trust-sso-provider-for-linking";

function randomId() {
	return Bun.randomUUIDv7();
}

function randomSlug(prefix: string) {
	return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function createRequest(path: string): Request {
	return new Request(`http://test.local${path}`);
}

async function createSsoProviderRecord(
	providerId: string,
	autoLinkMatchingEmails: boolean,
	options: { organizationId?: string; userId?: string } = {},
) {
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
		autoLinkMatchingEmails,
	});

	return { organizationId, userId };
}

describe("resolveTrustedProvidersForRequest", () => {
	beforeEach(async () => {
		await db.delete(member);
		await db.delete(account);
		await db.delete(ssoProvider);
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

	test("returns auto-link-enabled providers from the callback provider organization", async () => {
		const { organizationId, userId } = await createSsoProviderRecord("pocket-id", true);

		await createSsoProviderRecord("acme-saml", true, { organizationId, userId });
		await createSsoProviderRecord("acme-disabled", false, { organizationId, userId });
		await createSsoProviderRecord("other-org-provider", true);

		const trustedProviders = await resolveTrustedProvidersForRequest(createRequest("/sso/callback/pocket-id"));

		expect([...trustedProviders].sort()).toEqual(["acme-saml", "pocket-id"]);
	});

	test("supports /sso/saml2/callback/:providerId paths", async () => {
		await createSsoProviderRecord("saml-provider", true);

		expect(await resolveTrustedProvidersForRequest(createRequest("/sso/saml2/callback/saml-provider"))).toEqual([
			"saml-provider",
		]);
	});

	test("supports callback paths nested under /api/auth", async () => {
		await createSsoProviderRecord("prefixed-provider", true);

		expect(await resolveTrustedProvidersForRequest(createRequest("/api/auth/sso/callback/prefixed-provider"))).toEqual([
			"prefixed-provider",
		]);
	});

	test("supports /sso/saml2/sp/acs/:providerId paths", async () => {
		await createSsoProviderRecord("saml-acs-provider", true);

		expect(await resolveTrustedProvidersForRequest(createRequest("/sso/saml2/sp/acs/saml-acs-provider"))).toEqual([
			"saml-acs-provider",
		]);
	});

	test("removes providers from the result when auto-linking is disabled", async () => {
		await createSsoProviderRecord("pocket-id", true);

		expect(await resolveTrustedProvidersForRequest(createRequest("/sso/callback/pocket-id"))).toEqual(["pocket-id"]);

		await db.update(ssoProvider).set({ autoLinkMatchingEmails: false }).where(eq(ssoProvider.providerId, "pocket-id"));

		expect(await resolveTrustedProvidersForRequest(createRequest("/sso/callback/pocket-id"))).toEqual([]);
	});
});
