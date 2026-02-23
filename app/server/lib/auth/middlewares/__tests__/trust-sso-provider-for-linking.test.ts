import { beforeEach, describe, expect, test } from "bun:test";
import type { GenericEndpointContext } from "@better-auth/core";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/db";
import { account, member, organization, ssoProvider, usersTable } from "~/server/db/schema";
import { isSsoCallbackPath, trustSsoProviderForLinking } from "../trust-sso-provider-for-linking";

function randomId() {
	return Bun.randomUUIDv7();
}

function randomSlug(prefix: string) {
	return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function createMockContext(options: {
	path: string;
	method?: string;
	params?: Record<string, string>;
	trustedProviders?: string[];
	enabled?: boolean;
}): GenericEndpointContext {
	const { path, method = "GET", params = {}, trustedProviders = [], enabled = true } = options;

	const accountLinking = {
		enabled,
		trustedProviders,
	};

	const context = {
		options: {
			account: {
				accountLinking,
			},
		},
	};

	return {
		path,
		body: {},
		query: {},
		headers: new Headers(),
		request: new Request(`http://test.local${path}`, { method }),
		params,
		method,
		context: context as GenericEndpointContext["context"],
	} as GenericEndpointContext;
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

describe("isSsoCallbackPath", () => {
	test("detects OIDC callback paths", () => {
		expect(isSsoCallbackPath("/sso/callback/pocket-id")).toBe(true);
	});

	test("ignores non-callback paths", () => {
		expect(isSsoCallbackPath("/sso/register")).toBe(false);
		expect(isSsoCallbackPath("/sign-in/email")).toBe(false);
	});
});

describe("trustSsoProviderForLinking", () => {
	beforeEach(async () => {
		await db.delete(member);
		await db.delete(account);
		await db.delete(ssoProvider);
		await db.delete(organization);
		await db.delete(usersTable);
	});

	test("adds callback provider to trusted providers", async () => {
		await createSsoProviderRecord("pocket-id", true);

		const ctx = createMockContext({
			path: "/sso/callback/pocket-id",
			params: { providerId: "pocket-id" },
		});

		await trustSsoProviderForLinking(ctx);

		expect(ctx.context.options.account?.accountLinking?.trustedProviders).toContain("pocket-id");
	});

	test("does not trust providers with disabled auto-linking", async () => {
		await createSsoProviderRecord("pocket-id", false);

		const ctx = createMockContext({
			path: "/sso/callback/pocket-id",
			params: { providerId: "pocket-id" },
		});

		await trustSsoProviderForLinking(ctx);

		expect(ctx.context.options.account?.accountLinking?.trustedProviders).toEqual([]);
	});

	test("replaces stale trusted providers with database state", async () => {
		await createSsoProviderRecord("pocket-id", true);

		const ctx = createMockContext({
			path: "/sso/callback/pocket-id",
			params: { providerId: "pocket-id" },
			trustedProviders: ["stale-provider"],
		});

		await trustSsoProviderForLinking(ctx);

		expect(ctx.context.options.account?.accountLinking?.trustedProviders).toEqual(["pocket-id"]);
	});

	test("does not trust unknown providers", async () => {
		const ctx = createMockContext({
			path: "/sso/callback/missing-provider",
			params: { providerId: "missing-provider" },
		});

		await trustSsoProviderForLinking(ctx);

		expect(ctx.context.options.account?.accountLinking?.trustedProviders).toEqual([]);
	});

	test("does not duplicate an existing provider", async () => {
		await createSsoProviderRecord("pocket-id", true);

		const ctx = createMockContext({
			path: "/sso/callback/pocket-id",
			params: { providerId: "pocket-id" },
			trustedProviders: ["pocket-id"],
		});

		await trustSsoProviderForLinking(ctx);

		expect(ctx.context.options.account?.accountLinking?.trustedProviders).toEqual(["pocket-id"]);
	});

	test("removes provider from trusted providers when auto-linking is disabled", async () => {
		await createSsoProviderRecord("pocket-id", true);

		const ctx = createMockContext({
			path: "/sso/callback/pocket-id",
			params: { providerId: "pocket-id" },
		});

		await trustSsoProviderForLinking(ctx);
		expect(ctx.context.options.account?.accountLinking?.trustedProviders).toEqual(["pocket-id"]);

		await db.update(ssoProvider).set({ autoLinkMatchingEmails: false }).where(eq(ssoProvider.providerId, "pocket-id"));

		await trustSsoProviderForLinking(ctx);
		expect(ctx.context.options.account?.accountLinking?.trustedProviders).toEqual([]);
	});

	test("does nothing when account linking is disabled", async () => {
		await createSsoProviderRecord("pocket-id", true);

		const ctx = createMockContext({
			path: "/sso/callback/pocket-id",
			params: { providerId: "pocket-id" },
			enabled: false,
		});

		await trustSsoProviderForLinking(ctx);

		expect(ctx.context.options.account?.accountLinking?.trustedProviders).toEqual([]);
	});

	test("does nothing when provider id cannot be extracted", async () => {
		const ctx = createMockContext({
			path: "/sso/callback/",
			params: {},
		});

		await trustSsoProviderForLinking(ctx);

		expect(ctx.context.options.account?.accountLinking?.trustedProviders).toEqual([]);
	});
});
