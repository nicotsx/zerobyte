import { expect, test } from "vitest";
import { createApp } from "~/server/app";
import { db } from "~/server/db/db";
import { ssoProvider } from "~/server/db/schema";
import { createTestSession } from "~/test/helpers/auth";
import { auth } from "~/server/lib/auth";

const app = createApp();

const insertSamlProvider = async (providerId: string) => {
	const session = await createTestSession();

	await db.insert(ssoProvider).values({
		id: Bun.randomUUIDv7(),
		providerId,
		organizationId: session.organizationId,
		userId: session.user.id,
		issuer: "https://zerobyte.example.test/saml",
		domain: "example.test",
		samlConfig: {
			issuer: "https://zerobyte.example.test/saml",
			entryPoint: "https://identity.example.test/sso",
			idpMetadata: {
				entityID: "https://identity.example.test/saml",
				singleSignOnService: [
					{
						Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
						Location: "https://identity.example.test/sso",
					},
				],
			},
			spMetadata: { entityID: "https://zerobyte.example.test/saml" },
			mapping: {},
		},
	});
	return session;
};

test.each([
	"/sso/saml2/sp/metadata",
	"/sso/saml2/sp/metadata/",
	"/sso/%73aml2/sp/metadata",
	"/sso/saml2//sp/metadata",
	"/sso/saml2/sp/acs/legacy",
	"/sso/saml2/callback/legacy",
	"/sso/saml2/sp/slo/legacy",
	"/sso/saml2/logout/legacy",
])("disables the SAML endpoint %s", async (path) => {
	for (const method of ["GET", "POST", "HEAD"]) {
		const response = await app.request(`/api/auth${path}`, { method });
		expect(response.status).toBe(404);
	}
});

test("blocks stored SAML metadata, provider mutations and sign-in", async () => {
	const providerId = `legacy-${Bun.randomUUIDv7()}`;
	const session = await insertSamlProvider(providerId);
	const original = await db.query.ssoProvider.findFirst({ where: { providerId } });
	await expect(auth.api.spMetadata({ query: { providerId } })).rejects.toThrow("SAML is not supported");
	const metadata = await app.request(`/api/auth/sso/saml2/sp/metadata?providerId=${providerId}`);
	expect(metadata.status).toBe(404);

	for (const path of ["/sso/register", "/sso/update-provider"]) {
		const response = await app.request(`/api/auth${path}`, {
			method: "POST",
			headers: { ...session.headers, "Content-Type": "application/json" },
			body: JSON.stringify({
				providerId,
				issuer: original?.issuer,
				domain: "example.test",
				organizationId: session.organizationId,
				samlConfig: original?.samlConfig,
			}),
		});
		expect(response.status).toBe(400);
		expect(await response.text()).toContain("Only OIDC");
	}
	expect(await db.query.ssoProvider.findFirst({ where: { providerId } })).toEqual(original);
	for (const providerType of [undefined, "saml", "oidc"]) {
		const login = await app.request("/api/auth/sign-in/sso", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ providerId, providerType, callbackURL: "/" }),
		});
		expect(login.status).toBe(400);
		expect(login.headers.get("Location")).toBeNull();
		expect((await login.json()).message).toBe(
			providerType === "saml" ? "Only OIDC SSO providers are supported" : "OIDC provider is not configured",
		);
	}
});

test("preserves OIDC registration, update and sign-in", async () => {
	const session = await createTestSession();
	const providerId = `oidc-${Bun.randomUUIDv7()}`;
	const headers = { ...session.headers, "Content-Type": "application/json" };
	const registered = await app.request("/api/auth/sso/register", {
		method: "POST",
		headers,
		body: JSON.stringify({
			providerId,
			issuer: "https://issuer.example.com",
			domain: "example.com",
			organizationId: session.organizationId,
			oidcConfig: {
				clientId: "client-id",
				clientSecret: "client-secret",
				skipDiscovery: true,
				authorizationEndpoint: "https://issuer.example.com/authorize",
				tokenEndpoint: "https://issuer.example.com/token",
				jwksEndpoint: "https://issuer.example.com/jwks",
			},
		}),
	});
	expect(registered.status).toBe(200);
	const updated = await app.request("/api/auth/sso/update-provider", {
		method: "POST",
		headers,
		body: JSON.stringify({ providerId, domain: "updated.example.com" }),
	});
	expect(updated.status).toBe(200);
	const login = await app.request("/api/auth/sign-in/sso", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ providerId, callbackURL: "/" }),
	});
	expect(login.status).toBe(200);
	expect((await login.json()).url).toMatch(/^https:\/\/issuer\.example\.com\/authorize\?/);
});
