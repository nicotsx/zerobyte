import { beforeEach, describe, expect, test } from "vitest";
import { createApp } from "~/server/app";
import { db } from "~/server/db/db";
import { account, invitation, member, organization, ssoProvider, usersTable, verification } from "~/server/db/schema";
import { createTestSession, createTestSessionWithOrgAdmin } from "~/test/helpers/auth";

const app = createApp();
const ssoRegisterUrl = new URL("/api/auth/sso/register", "http://localhost:3000").toString();

function buildRegisterBody(organizationId: string, suffix: string) {
	return {
		providerId: `oidc-${suffix}-${Bun.randomUUIDv7()}`,
		issuer: "https://issuer.example.com",
		domain: "example.com",
		organizationId,
		oidcConfig: {
			clientId: "client-id",
			clientSecret: "client-secret",
			skipDiscovery: true,
			discoveryEndpoint: "https://issuer.example.com/.well-known/openid-configuration",
			authorizationEndpoint: "https://issuer.example.com/oauth2/authorize",
			tokenEndpoint: "https://issuer.example.com/oauth2/token",
			jwksEndpoint: "https://issuer.example.com/.well-known/jwks.json",
		},
	};
}

describe("SSO provider registration authorization", () => {
	beforeEach(async () => {
		await db.delete(member);
		await db.delete(account);
		await db.delete(invitation);
		await db.delete(ssoProvider);
		await db.delete(verification);
		await db.delete(organization);
		await db.delete(usersTable);
	});

	test("allows organization owners to register providers for their active organization", async () => {
		const { headers, organizationId } = await createTestSession();

		const response = await app.request(ssoRegisterUrl, {
			method: "POST",
			headers: {
				...headers,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(buildRegisterBody(organizationId, "owner")),
		});

		expect(response.status).toBe(200);
	});

	test("rejects org admins for registration when they are not owners", async () => {
		const { headers, organizationId } = await createTestSessionWithOrgAdmin();

		const response = await app.request(ssoRegisterUrl, {
			method: "POST",
			headers: {
				...headers,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(buildRegisterBody(organizationId, "admin")),
		});

		expect(response.status).toBe(403);

		const body = await response.json();
		expect(body.message).toBe("Only organization owners can register SSO providers");
	});

	test("rejects users who are owners elsewhere but only members of the target organization", async () => {
		const { headers, user } = await createTestSession();
		const targetOrgId = Bun.randomUUIDv7();

		await db.insert(organization).values({
			id: targetOrgId,
			name: "Target Org",
			slug: `target-org-${Date.now()}`,
			createdAt: new Date(),
		});

		await db.insert(member).values({
			id: Bun.randomUUIDv7(),
			userId: user.id,
			organizationId: targetOrgId,
			role: "member",
			createdAt: new Date(),
		});

		const response = await app.request(ssoRegisterUrl, {
			method: "POST",
			headers: {
				...headers,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(buildRegisterBody(targetOrgId, "cross-org")),
		});

		expect(response.status).toBe(403);

		const body = await response.json();
		expect(body.message).toBe("Only organization owners can register SSO providers");
	});
});
