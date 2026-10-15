import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "~/server/app";
import { auth } from "~/server/lib/auth";
import { config } from "~/server/core/config";
import { db } from "~/server/db/db";
import { account, member, ssoProvider } from "~/server/db/schema";
import { createTestSession } from "~/test/helpers/auth";
import { http, HttpResponse, server } from "~/test/msw/server";

const app = createApp();
const issuer = "https://identity.example.com";
const discoveryEndpoint = `${issuer}/.well-known/openid-configuration`;

beforeAll(async () => {
	(await auth.$context).trustedOrigins.push(issuer);
	config.trustedOrigins.push(issuer);
	server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => server.resetHandlers());
afterAll(async () => {
	const context = await auth.$context;
	context.trustedOrigins.splice(context.trustedOrigins.indexOf(issuer), 1);
	config.trustedOrigins.splice(config.trustedOrigins.indexOf(issuer), 1);
	server.close();
});

async function setup(linked = false) {
	const session = await createTestSession();
	const providerId = `oidc-${Bun.randomUUIDv7()}`;

	await db.insert(ssoProvider).values({
		id: Bun.randomUUIDv7(),
		providerId,
		organizationId: session.organizationId,
		userId: session.user.id,
		issuer: `${issuer}/`,
		domain: "example.com",
		oidcConfig: {
			issuer: `${issuer}/`,
			clientId: "client-id",
			clientSecret: "stored-secret",
			discoveryEndpoint,
			authorizationEndpoint: `${issuer}/authorize`,
			tokenEndpoint: `${issuer}/token`,
			jwksEndpoint: `${issuer}/jwks`,
			mapping: { email: "mail" },
		},
	});

	if (linked) {
		await db.insert(account).values({
			id: Bun.randomUUIDv7(),
			providerId,
			userId: session.user.id,
			accountId: "existing-subject",
		});
	}

	server.use(
		http.get(discoveryEndpoint, () =>
			HttpResponse.json({
				issuer,
				authorization_endpoint: `${issuer}/authorize`,
				token_endpoint: `${issuer}/token`,
				jwks_uri: `${issuer}/jwks`,
			}),
		),
	);

	const url = `http://localhost:3000/api/v1/auth/sso-providers/${providerId}`;
	const patch = (body: unknown, headers = session.headers) =>
		app.request(url, {
			method: "PATCH",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

	return { ...session, providerId, url, patch };
}

test("loads saved settings without discovery or returning credentials", async () => {
	const provider = await setup(true);
	const discoveryRequest = vi.fn(() => HttpResponse.error());
	server.use(http.get(discoveryEndpoint, discoveryRequest));
	const response = await app.request(provider.url, { headers: provider.headers });

	expect(response.status).toBe(200);
	const body = await response.json();
	expect(body).toMatchObject({
		issuer: `${issuer}/`,
		hasLinkedAccounts: true,
	});
	expect(JSON.stringify(body)).not.toContain("stored-secret");
	expect(discoveryRequest).not.toHaveBeenCalled();
});

test("checks the saved issuer against discovery only when requested", async () => {
	const provider = await setup(true);
	const response = await app.request(`${provider.url}/discovery`, { headers: provider.headers });

	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({ discoveryIssuer: issuer, discoveryStatus: "issuer_mismatch" });
});

test("corrects a discovery-confirmed trailing slash without losing linked accounts or other settings", async () => {
	const provider = await setup(true);
	const response = await provider.patch({ issuer, domain: "example.com", discoveryEndpoint });

	expect(response.status).toBe(200);
	const stored = await db.query.ssoProvider.findFirst({ where: { providerId: provider.providerId } });
	expect(stored?.issuer).toBe(issuer);
	expect(stored?.oidcConfig).toMatchObject({
		issuer,
		clientId: "client-id",
		clientSecret: "stored-secret",
		mapping: { email: "mail" },
	});
	expect(await db.query.account.findFirst({ where: { providerId: provider.providerId } })).toMatchObject({
		accountId: "existing-subject",
	});
});

test("rejects an arbitrary issuer change while accounts are linked", async () => {
	const provider = await setup(true);
	server.use(
		http.get(discoveryEndpoint, () =>
			HttpResponse.json({
				issuer: `${issuer}/different`,
				authorization_endpoint: `${issuer}/authorize`,
				token_endpoint: `${issuer}/token`,
				jwks_uri: `${issuer}/jwks`,
			}),
		),
	);
	const response = await provider.patch({ issuer: `${issuer}/different` });

	expect(response.status).toBe(409);
	expect((await db.query.ssoProvider.findFirst({ where: { providerId: provider.providerId } }))?.issuer).toBe(
		`${issuer}/`,
	);
});

test("rejects replacing the client identity while accounts are linked", async () => {
	const provider = await setup(true);
	const response = await provider.patch({
		issuer,
		domain: "example.com",
		discoveryEndpoint,
		clientId: "different-client",
	});

	expect(response.status).toBe(409);
});

test("does not accept an unconfirmed issuer correction when discovery fails", async () => {
	const provider = await setup(true);
	server.use(http.get(discoveryEndpoint, () => new HttpResponse(null, { status: 503 })));
	const response = await provider.patch({ issuer, domain: "example.com", discoveryEndpoint });

	expect(response.status).toBe(400);
	expect((await db.query.ssoProvider.findFirst({ where: { providerId: provider.providerId } }))?.issuer).toBe(
		`${issuer}/`,
	);
});

test("keeps settings editable while discovery is unavailable and retains the existing secret", async () => {
	const provider = await setup(true);
	server.use(http.get(discoveryEndpoint, () => new HttpResponse(null, { status: 503 })));
	const response = await provider.patch({ domain: "updated.example.com" });

	expect(response.status).toBe(200);
	expect(
		(await db.query.ssoProvider.findFirst({ where: { providerId: provider.providerId } }))?.oidcConfig
			?.clientSecret,
	).toBe("stored-secret");
});

test("does not disclose or update a provider in another organization", async () => {
	const provider = await setup();
	const other = await createTestSession();

	expect((await app.request(provider.url, { headers: other.headers })).status).toBe(404);
	expect((await provider.patch({ issuer, domain: "example.com", discoveryEndpoint }, other.headers)).status).toBe(
		404,
	);
});

test("rejects members editing provider settings", async () => {
	const provider = await setup();
	await db.update(member).set({ role: "member" }).where(eq(member.userId, provider.user.id));

	expect((await provider.patch({ issuer, domain: "example.com", discoveryEndpoint })).status).toBe(403);
});

test("redirects to configured endpoints without checking discovery", async () => {
	const provider = await setup();
	const discoveryRequest = vi.fn(() => HttpResponse.error());
	server.use(http.get(discoveryEndpoint, discoveryRequest));
	const response = await app.request("http://localhost:3000/api/auth/sign-in/sso", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ providerId: provider.providerId, callbackURL: "/login" }),
	});

	expect(response.status).toBe(200);
	expect(new URL((await response.json()).url).origin).toBe(issuer);
	expect(discoveryRequest).not.toHaveBeenCalled();
});

test("rejects a trailing-slash mismatch during registration with the exact correction", async () => {
	const provider = await setup();
	const response = await app.request("http://localhost:3000/api/auth/sso/register", {
		method: "POST",
		headers: { ...provider.headers, "Content-Type": "application/json" },
		body: JSON.stringify({
			providerId: `new-${Bun.randomUUIDv7()}`,
			organizationId: provider.organizationId,
			issuer: `${issuer}/`,
			domain: "example.com",
			oidcConfig: { clientId: "new-client", clientSecret: "new-secret", discoveryEndpoint },
		}),
	});

	expect(response.status).toBe(400);
	expect(await response.json()).toMatchObject({
		code: "SSO_ISSUER_MISMATCH",
		message: expect.stringContaining(issuer),
	});
});

test("keeps sign-in available with configured endpoints when discovery is temporarily unavailable", async () => {
	const provider = await setup();
	server.use(http.get(discoveryEndpoint, () => new HttpResponse(null, { status: 503 })));
	const response = await app.request("http://localhost:3000/api/auth/sign-in/sso", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ providerId: provider.providerId, callbackURL: "/login" }),
	});

	expect(response.status).toBe(200);
	expect(new URL((await response.json()).url).origin).toBe(issuer);
});

test("does not fetch untrusted discovery URLs or accept their issuer corrections", async () => {
	const provider = await setup();
	const response = await provider.patch({
		issuer,
		domain: "example.com",
		discoveryEndpoint: "https://untrusted.example.com/.well-known/openid-configuration",
	});

	expect(response.status).toBe(400);
	expect(await response.json()).toMatchObject({ message: expect.stringMatching(/trusted.*origins/i) });
});

test("refuses an issuer correction when discovery confirms a different value", async () => {
	const provider = await setup(true);
	server.use(
		http.get(discoveryEndpoint, () =>
			HttpResponse.json({
				issuer: `${issuer}/`,
				authorization_endpoint: `${issuer}/authorize`,
				token_endpoint: `${issuer}/token`,
				jwks_uri: `${issuer}/jwks`,
			}),
		),
	);
	const response = await provider.patch({ issuer, domain: "example.com", discoveryEndpoint });

	expect(response.status).toBe(400);
	expect((await db.query.ssoProvider.findFirst({ where: { providerId: provider.providerId } }))?.issuer).toBe(
		`${issuer}/`,
	);
});

test("rotates a linked provider's secret without changing its identity", async () => {
	const provider = await setup(true);
	const response = await provider.patch({
		clientSecret: "replacement-secret",
	});

	expect(response.status).toBe(200);
	expect(
		(await db.query.ssoProvider.findFirst({ where: { providerId: provider.providerId } }))?.oidcConfig,
	).toMatchObject({
		clientSecret: "replacement-secret",
		clientId: "client-id",
		issuer: `${issuer}/`,
		mapping: { email: "mail" },
	});
});

test("updates discovered endpoints when editing an unlinked provider", async () => {
	const provider = await setup();
	const updatedDiscoveryEndpoint = `${issuer}/new-discovery`;
	server.use(
		http.get(updatedDiscoveryEndpoint, () =>
			HttpResponse.json({
				issuer,
				authorization_endpoint: "/new-authorize",
				token_endpoint: "/new-token",
				jwks_uri: "/new-jwks",
				token_endpoint_auth_methods_supported: ["client_secret_post"],
			}),
		),
	);
	const response = await provider.patch({
		issuer,
		domain: "example.com",
		discoveryEndpoint: updatedDiscoveryEndpoint,
		clientId: "new-client",
	});

	expect(response.status).toBe(200);
	expect(
		(await db.query.ssoProvider.findFirst({ where: { providerId: provider.providerId } }))?.oidcConfig,
	).toMatchObject({
		issuer,
		clientId: "new-client",
		clientSecret: "stored-secret",
		authorizationEndpoint: `${issuer}/new-authorize`,
		tokenEndpoint: `${issuer}/new-token`,
		jwksEndpoint: `${issuer}/new-jwks`,
		tokenEndpointAuthentication: "client_secret_post",
	});
});

test("rechecks linked accounts after discovery before changing a provider's client identity", async () => {
	const provider = await setup();
	server.use(
		http.get(discoveryEndpoint, async () => {
			await db.insert(account).values({
				id: Bun.randomUUIDv7(),
				providerId: provider.providerId,
				userId: provider.user.id,
				accountId: "linked-during-discovery",
			});
			return HttpResponse.json({
				issuer,
				authorization_endpoint: `${issuer}/authorize`,
				token_endpoint: `${issuer}/token`,
				jwks_uri: `${issuer}/jwks`,
			});
		}),
	);
	const response = await provider.patch({ issuer, domain: "example.com", discoveryEndpoint, clientId: "new-client" });

	expect(response.status).toBe(409);
	expect(
		(await db.query.ssoProvider.findFirst({ where: { providerId: provider.providerId } }))?.oidcConfig?.clientId,
	).toBe("client-id");
});

test("returns a validation error for a malformed issuer URL without changing the provider", async () => {
	const provider = await setup();
	const response = await provider.patch({ issuer: "not-a-url", domain: "example.com", discoveryEndpoint });

	expect(response.status).toBe(400);
	expect((await db.query.ssoProvider.findFirst({ where: { providerId: provider.providerId } }))?.issuer).toBe(
		`${issuer}/`,
	);
});

test("preserves concurrent unrelated edits while correcting the issuer", async () => {
	const provider = await setup(true);
	const stored = await db.query.ssoProvider.findFirst({ where: { providerId: provider.providerId } });
	server.use(
		http.get(discoveryEndpoint, async () => {
			await db
				.update(ssoProvider)
				.set({
					domain: "updated.example.com",
					oidcConfig: { ...stored?.oidcConfig, clientSecret: "rotated-during-discovery" },
				})
				.where(eq(ssoProvider.providerId, provider.providerId));

			return HttpResponse.json({
				issuer,
				authorization_endpoint: "/authorize",
				token_endpoint: "/token",
				jwks_uri: "/jwks",
			});
		}),
	);
	const response = await provider.patch({ issuer });

	expect(response.status).toBe(200);
	expect(await db.query.ssoProvider.findFirst({ where: { providerId: provider.providerId } })).toMatchObject({
		issuer,
		domain: "updated.example.com",
		oidcConfig: { clientSecret: "rotated-during-discovery", mapping: { email: "mail" } },
	});
});

test("keeps discovery diagnostics scoped to organization owners", async () => {
	const provider = await setup();
	const other = await createTestSession();
	const url = `${provider.url}/discovery`;

	expect((await app.request(url, { headers: other.headers })).status).toBe(404);
	await db.update(member).set({ role: "member" }).where(eq(member.userId, provider.user.id));
	expect((await app.request(url, { headers: provider.headers })).status).toBe(403);
});
