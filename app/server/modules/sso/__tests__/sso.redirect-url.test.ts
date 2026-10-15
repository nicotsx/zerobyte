import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
});

test.each([
	{
		baseUrl: "https://zerobyte.example.com",
		trustProxy: "true",
		requestUrl: "http://zerobyte:4096",
		forwardedHost: "zerobyte.example.com",
		forwardedProto: "https",
		expectedCallback: "https://zerobyte.example.com/api/auth/sso/callback/example-oidc",
	},
	{
		baseUrl: "https://zerobyte.example.com",
		trustProxy: "true",
		requestUrl: "http://zerobyte.example.com",
		forwardedHost: undefined,
		forwardedProto: "https",
		expectedCallback: "https://zerobyte.example.com/api/auth/sso/callback/example-oidc",
	},
	{
		baseUrl: "https://zerobyte.example.com",
		trustedOrigins: "http://192.168.1.10:4096",
		trustProxy: "true",
		requestUrl: "http://192.168.1.10:4096",
		forwardedHost: undefined,
		forwardedProto: undefined,
		expectedCallback: "http://192.168.1.10:4096/api/auth/sso/callback/example-oidc",
	},
	{
		baseUrl: "http://192.168.1.10:4096",
		trustedOrigins: "https://zerobyte.example.com",
		trustProxy: "true",
		requestUrl: "http://zerobyte:4096",
		forwardedHost: "zerobyte.example.com",
		forwardedProto: "https",
		expectedCallback: "https://zerobyte.example.com/api/auth/sso/callback/example-oidc",
	},
	{
		baseUrl: "http://192.168.1.10:4096",
		trustedOrigins: "https://zerobyte.example.com",
		trustProxy: "false",
		requestUrl: "http://192.168.1.10:4096",
		forwardedHost: "zerobyte.example.com",
		forwardedProto: "https",
		expectedCallback: "http://192.168.1.10:4096/api/auth/sso/callback/example-oidc",
	},
	{
		baseUrl: "https://zerobyte.example.com",
		trustedOrigins: "http://zerobyte.example.com/",
		trustProxy: "false",
		requestUrl: "http://zerobyte.example.com",
		forwardedHost: undefined,
		forwardedProto: undefined,
		expectedCallback: "http://zerobyte.example.com/api/auth/sso/callback/example-oidc",
	},
])("uses the expected public callback with BASE_URL=$baseUrl and TRUST_PROXY=$trustProxy", async (proxy) => {
	vi.stubEnv("BASE_URL", proxy.baseUrl);
	vi.stubEnv("TRUST_PROXY", proxy.trustProxy);
	vi.stubEnv("TRUSTED_ORIGINS", proxy.trustedOrigins);
	vi.resetModules();

	const { db, runDbMigrations } = await import("~/server/db/db");
	const { organization, ssoProvider } = await import("~/server/db/schema");
	const { auth } = await import("~/server/lib/auth");
	const { getSsoCallbackDiagnostics } = await import("../sso-configuration");
	const { resolveAuthBaseURL } = await import("~/server/lib/auth/request-base-url");

	await runDbMigrations();

	const organizationId = Bun.randomUUIDv7();
	await db.insert(organization).values({
		id: organizationId,
		name: "Example",
		slug: "example",
		createdAt: new Date(),
	});

	await db.insert(ssoProvider).values({
		id: Bun.randomUUIDv7(),
		providerId: "example-oidc",
		organizationId,
		issuer: "https://idp.example.com",
		domain: "example.com",
		oidcConfig: {
			clientId: "example-client",
			clientSecret: "example-secret",
			skipDiscovery: true,
			authorizationEndpoint: "https://idp.example.com/authorize",
			tokenEndpoint: "https://idp.example.com/token",
			jwksEndpoint: "https://idp.example.com/jwks",
		},
	});

	const response = await auth.handler(
		new Request(`${proxy.requestUrl}/api/auth/sign-in/sso`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(proxy.forwardedHost && { "X-Forwarded-Host": proxy.forwardedHost }),
				...(proxy.forwardedProto && { "X-Forwarded-Proto": proxy.forwardedProto }),
			},
			body: JSON.stringify({ providerId: "example-oidc", callbackURL: "/" }),
		}),
	);

	expect(response.status).toBe(200);

	const { url } = (await response.json()) as { url: string };
	const redirectUri = new URL(url).searchParams.get("redirect_uri");

	expect(redirectUri).toBe(proxy.expectedCallback);
	const request = new Request(proxy.requestUrl, {
		headers: {
			...(proxy.forwardedHost && { "X-Forwarded-Host": proxy.forwardedHost }),
			...(proxy.forwardedProto && { "X-Forwarded-Proto": proxy.forwardedProto }),
		},
	});
	expect(getSsoCallbackDiagnostics(request, "example-oidc").callbackUrl).toBe(redirectUri);
	expect(`${resolveAuthBaseURL(request)}/sso/callback/example-oidc`).toBe(redirectUri);
});

test("diagnoses an HTTP callback without blocking sign-in to configured endpoints", async () => {
	vi.stubEnv("BASE_URL", "https://zerobyte.example.com");
	vi.stubEnv("TRUST_PROXY", "false");
	vi.stubEnv("TRUSTED_ORIGINS", undefined);
	vi.resetModules();

	const { db, runDbMigrations } = await import("~/server/db/db");
	const { organization, ssoProvider } = await import("~/server/db/schema");
	const { auth } = await import("~/server/lib/auth");
	await runDbMigrations();

	const organizationId = Bun.randomUUIDv7();
	await db
		.insert(organization)
		.values({ id: organizationId, name: "Example", slug: "proxy-example", createdAt: new Date() });
	await db.insert(ssoProvider).values({
		id: Bun.randomUUIDv7(),
		providerId: "proxy-oidc",
		organizationId,
		issuer: "https://idp.example.com",
		domain: "example.com",
		oidcConfig: {
			clientId: "example-client",
			clientSecret: "example-secret",
			skipDiscovery: true,
			authorizationEndpoint: "https://idp.example.com/authorize",
			tokenEndpoint: "https://idp.example.com/token",
			jwksEndpoint: "https://idp.example.com/jwks",
		},
	});

	const response = await auth.handler(
		new Request("http://zerobyte.example.com/api/auth/sign-in/sso", {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https" },
			body: JSON.stringify({ providerId: "proxy-oidc", callbackURL: "/login" }),
		}),
	);

	expect(response.status).toBe(200);
	const { getSsoCallbackDiagnostics } = await import("../sso-configuration");
	expect(getSsoCallbackDiagnostics(new Request("http://zerobyte.example.com"), "proxy-oidc")).toMatchObject({
		proxyMisconfigured: true,
		expectedCallbackUrl: "https://zerobyte.example.com/api/auth/sso/callback/proxy-oidc",
	});
});

test.each([
	{
		name: "ignores an untrusted HTTPS origin",
		baseUrl: "http://zerobyte.example.com",
		trustedOrigins: undefined,
		origin: "https://zerobyte.example.com",
		expectedCallbackUrl: null,
	},
	{
		name: "ignores an untrusted HTTP origin that would hide a proxy warning",
		baseUrl: "https://zerobyte.example.com",
		trustedOrigins: undefined,
		origin: "http://zerobyte.example.com",
		expectedCallbackUrl: "https://zerobyte.example.com/api/auth/sso/callback/example-oidc",
	},
	{
		name: "preserves a trusted public origin different from BASE_URL after canonicalization",
		baseUrl: "http://192.168.1.10:4096",
		trustedOrigins: "https://ZEROBYTE.example.com:443/",
		origin: "https://zerobyte.example.com",
		expectedCallbackUrl: "https://zerobyte.example.com/api/auth/sso/callback/example-oidc",
	},
	{
		name: "preserves an explicitly trusted HTTP origin",
		baseUrl: "https://zerobyte.example.com",
		trustedOrigins: "http://zerobyte.example.com/",
		origin: "http://zerobyte.example.com",
		expectedCallbackUrl: null,
	},
	{
		name: "falls back to BASE_URL when Origin is missing",
		baseUrl: "https://zerobyte.example.com",
		trustedOrigins: undefined,
		origin: undefined,
		expectedCallbackUrl: "https://zerobyte.example.com/api/auth/sso/callback/example-oidc",
	},
	{
		name: "falls back to BASE_URL when Origin is malformed",
		baseUrl: "https://zerobyte.example.com",
		trustedOrigins: undefined,
		origin: "not-a-url",
		expectedCallbackUrl: "https://zerobyte.example.com/api/auth/sso/callback/example-oidc",
	},
])("callback diagnostics $name", async ({ baseUrl, trustedOrigins, origin, expectedCallbackUrl }) => {
	vi.stubEnv("BASE_URL", baseUrl);
	vi.stubEnv("TRUST_PROXY", "false");
	vi.stubEnv("TRUSTED_ORIGINS", trustedOrigins);

	const { getSsoCallbackDiagnostics } = await import("../sso-configuration");
	const request = new Request("http://zerobyte.example.com", { headers: origin ? { Origin: origin } : {} });

	expect(getSsoCallbackDiagnostics(request, "example-oidc")).toEqual({
		callbackUrl: "http://zerobyte.example.com/api/auth/sso/callback/example-oidc",
		expectedCallbackUrl,
		proxyMisconfigured: expectedCallbackUrl !== null,
	});
});
