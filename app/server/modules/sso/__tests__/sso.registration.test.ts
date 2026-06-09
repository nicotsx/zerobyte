import { beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "~/server/app";
import { db } from "~/server/db/db";
import { account, invitation, member, organization, ssoProvider, usersTable, verification } from "~/server/db/schema";
import { createTestSession, createTestSessionWithOrgAdmin } from "~/test/helpers/auth";
import { SSO_INVITATION_INTENT_COOKIE, ssoService } from "../sso.service";

const app = createApp();
const ssoRegisterUrl = new URL("/api/auth/sso/register", "http://localhost:3000").toString();
const listUserInvitationsUrl = new URL(
	"/api/auth/organization/list-user-invitations",
	"http://localhost:3000",
).toString();
const acceptInvitationUrl = new URL("/api/auth/organization/accept-invitation", "http://localhost:3000").toString();
const userSsoInvitationsUrl = new URL("/api/v1/auth/sso-invitations", "http://localhost:3000").toString();

function buildRegisterBody(organizationId: string, suffix: string) {
	return {
		providerId: `oidc-${suffix}-${crypto.randomUUID()}`,
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
		const targetOrgId = crypto.randomUUID();

		await db.insert(organization).values({
			id: targetOrgId,
			name: "Target Org",
			slug: `target-org-${Date.now()}`,
			createdAt: new Date(),
		});

		await db.insert(member).values({
			id: crypto.randomUUID(),
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

describe("organization invitation acceptance", () => {
	beforeEach(async () => {
		await db.delete(member);
		await db.delete(account);
		await db.delete(invitation);
		await db.delete(ssoProvider);
		await db.delete(verification);
		await db.delete(organization);
		await db.delete(usersTable);
	});

	test("requires org SSO verification before an unverified local recipient can claim an invitation", async () => {
		const inviter = await createTestSession();
		const recipient = await createTestSession();
		const invitationId = crypto.randomUUID();

		await db.update(usersTable).set({ emailVerified: false }).where(eq(usersTable.id, recipient.user.id));
		await db.insert(invitation).values({
			id: invitationId,
			organizationId: inviter.organizationId,
			email: recipient.user.email,
			role: "member",
			status: "pending",
			expiresAt: new Date(Date.now() + 60 * 60 * 1000),
			createdAt: new Date(),
			inviterId: inviter.user.id,
		});
		await db.insert(ssoProvider).values([
			{
				id: crypto.randomUUID(),
				providerId: "oidc-primary",
				organizationId: inviter.organizationId,
				userId: inviter.user.id,
				issuer: "https://issuer.example.com",
				domain: "example.com",
			},
			{
				id: crypto.randomUUID(),
				providerId: "oidc-backup",
				organizationId: inviter.organizationId,
				userId: inviter.user.id,
				issuer: "https://backup-issuer.example.com",
				domain: "example.com",
			},
		]);

		const listResponse = await app.request(listUserInvitationsUrl, {
			method: "GET",
			headers: recipient.headers,
		});

		expect(listResponse.status).toBe(403);

		const customListResponse = await app.request(userSsoInvitationsUrl, {
			method: "GET",
			headers: recipient.headers,
		});

		expect(customListResponse.status).toBe(200);
		await expect(customListResponse.json()).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: invitationId,
					ssoProviders: expect.arrayContaining([
						expect.objectContaining({ providerId: "oidc-primary" }),
						expect.objectContaining({ providerId: "oidc-backup" }),
					]),
				}),
			]),
		);

		const acceptResponse = await app.request(acceptInvitationUrl, {
			method: "POST",
			headers: {
				...recipient.headers,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ invitationId }),
		});

		expect(acceptResponse.status).toBe(403);

		const verifyResponse = await app.request(`${userSsoInvitationsUrl}/${invitationId}/verify`, {
			method: "POST",
			headers: {
				...recipient.headers,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ providerId: "oidc-backup" }),
		});

		expect(verifyResponse.status).toBe(200);
		const intentCookie = verifyResponse.headers
			.get("set-cookie")
			?.split(";")
			.find((part) => part.trim().startsWith(`${SSO_INVITATION_INTENT_COOKIE}=`));
		const intentToken = intentCookie?.split("=")[1];
		expect(intentToken).toBeTruthy();

		const intent = await ssoService.getValidInvitationSsoIntent(intentToken);
		expect(intent).toEqual({
			userId: recipient.user.id,
			invitationId,
			providerId: "oidc-backup",
			organizationId: inviter.organizationId,
			email: recipient.user.email.toLowerCase(),
		});

		const acceptedInvitation = await db.query.invitation.findFirst({ where: { id: invitationId } });
		expect(acceptedInvitation?.status).toBe("pending");

		const membership = await db.query.member.findFirst({
			where: { AND: [{ userId: recipient.user.id }, { organizationId: inviter.organizationId }] },
		});
		expect(membership).toBeUndefined();
	});
});
