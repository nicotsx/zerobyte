import { beforeEach, describe, expect, test } from "bun:test";
import type { GenericEndpointContext } from "better-auth";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/db";
import { account, invitation, member, organization, ssoProvider, usersTable } from "~/server/db/schema";
import { ssoIntegration } from "../sso.integration";

function createMockSsoCallbackContext(providerId: string): GenericEndpointContext {
	return {
		path: `/sso/callback/${providerId}`,
		body: {},
		query: {},
		headers: new Headers(),
		request: new Request(`http://localhost:3000/sso/callback/${providerId}`),
		params: { providerId },
		method: "POST",
		context: {} as GenericEndpointContext["context"],
	} as unknown as GenericEndpointContext;
}

function randomId() {
	return Bun.randomUUIDv7();
}

function randomSlug(prefix: string) {
	return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createUser(email: string, username: string) {
	const userId = randomId();
	await db.insert(usersTable).values({
		id: userId,
		email,
		name: username,
		username,
	});
	return userId;
}

describe("ssoIntegration.resolveOrgMembership", () => {
	beforeEach(async () => {
		await db.delete(member);
		await db.delete(account);
		await db.delete(invitation);
		await db.delete(ssoProvider);
		await db.delete(organization);
		await db.delete(usersTable);
	});

	test("creates invited membership from SSO callback request context", async () => {
		const invitedUserId = await createUser("invited@example.com", randomSlug("invited"));
		const inviterId = await createUser("inviter@example.com", randomSlug("inviter"));
		const organizationId = randomId();

		await db.insert(organization).values({
			id: organizationId,
			name: "Acme",
			slug: randomSlug("acme"),
			createdAt: new Date(),
		});

		await db.insert(ssoProvider).values({
			id: randomId(),
			providerId: "oidc-acme",
			organizationId,
			userId: inviterId,
			issuer: "https://issuer.example.com",
			domain: "example.com",
		});

		await db.insert(invitation).values({
			id: randomId(),
			organizationId,
			email: "invited@example.com",
			role: "member",
			status: "pending",
			expiresAt: new Date(Date.now() + 60 * 60 * 1000),
			createdAt: new Date(),
			inviterId,
		});

		const ctx = createMockSsoCallbackContext("oidc-acme");
		const membership = await ssoIntegration.resolveOrgMembership(invitedUserId, ctx);

		expect(membership).not.toBeNull();
		expect(membership?.organizationId).toBe(organizationId);
		expect(membership?.role).toBe("member");

		const updatedInvitations = await db.select().from(invitation).where(eq(invitation.organizationId, organizationId));
		const updatedInvitation = updatedInvitations.find((i) => i.email === "invited@example.com");
		expect(updatedInvitation?.status).toBe("accepted");
	});

	test("blocks SSO callback users without pending invitations", async () => {
		const userId = await createUser("new-user@example.com", randomSlug("new-user"));
		const inviterId = await createUser("inviter@example.com", randomSlug("inviter"));
		const organizationId = randomId();

		await db.insert(organization).values({
			id: organizationId,
			name: "Acme",
			slug: randomSlug("acme"),
			createdAt: new Date(),
		});

		await db.insert(ssoProvider).values({
			id: randomId(),
			providerId: "oidc-acme",
			organizationId,
			userId: inviterId,
			issuer: "https://issuer.example.com",
			domain: "example.com",
		});

		const ctx = createMockSsoCallbackContext("oidc-acme");
		await expect(ssoIntegration.resolveOrgMembership(userId, ctx)).rejects.toThrow("invite-only");
	});

	test("blocks existing users with a personal org from SSO orgs they were not invited to", async () => {
		const userId = await createUser("alice@example.com", randomSlug("alice"));
		const inviterId = await createUser("inviter@example.com", randomSlug("inviter"));

		const personalOrgId = randomId();
		await db.insert(organization).values({
			id: personalOrgId,
			name: "Alice's Workspace",
			slug: randomSlug("alice"),
			createdAt: new Date(),
		});
		await db.insert(member).values({
			id: randomId(),
			userId,
			organizationId: personalOrgId,
			role: "owner",
			createdAt: new Date(),
		});

		const ssoOrgId = randomId();
		await db.insert(organization).values({
			id: ssoOrgId,
			name: "Acme Corp",
			slug: randomSlug("acme"),
			createdAt: new Date(),
		});
		await db.insert(ssoProvider).values({
			id: randomId(),
			providerId: "oidc-acme",
			organizationId: ssoOrgId,
			userId: inviterId,
			issuer: "https://issuer.example.com",
			domain: "example.com",
		});

		const ctx = createMockSsoCallbackContext("oidc-acme");
		await expect(ssoIntegration.resolveOrgMembership(userId, ctx)).rejects.toThrow("invite-only");
	});

	test("returns null when context is not an SSO callback", async () => {
		const userId = await createUser("local-user@example.com", randomSlug("local-user"));

		const result = await ssoIntegration.resolveOrgMembership(userId, null);
		expect(result).toBeNull();
	});

	test("blocks user whose invitation has expired", async () => {
		const userId = await createUser("expired@example.com", randomSlug("expired"));
		const inviterId = await createUser("inviter@example.com", randomSlug("inviter"));
		const organizationId = randomId();

		await db.insert(organization).values({
			id: organizationId,
			name: "Acme",
			slug: randomSlug("acme"),
			createdAt: new Date(),
		});

		await db.insert(ssoProvider).values({
			id: randomId(),
			providerId: "oidc-acme",
			organizationId,
			userId: inviterId,
			issuer: "https://issuer.example.com",
			domain: "example.com",
		});

		await db.insert(invitation).values({
			id: randomId(),
			organizationId,
			email: "expired@example.com",
			role: "member",
			status: "pending",
			expiresAt: new Date(Date.now() - 60 * 60 * 1000), // expired 1 hour ago
			createdAt: new Date(),
			inviterId,
		});

		const ctx = createMockSsoCallbackContext("oidc-acme");
		await expect(ssoIntegration.resolveOrgMembership(userId, ctx)).rejects.toThrow("invite-only");
	});

	test("blocks user whose invitation was already accepted", async () => {
		const userId = await createUser("returning@example.com", randomSlug("returning"));
		const inviterId = await createUser("inviter@example.com", randomSlug("inviter"));
		const organizationId = randomId();

		await db.insert(organization).values({
			id: organizationId,
			name: "Acme",
			slug: randomSlug("acme"),
			createdAt: new Date(),
		});

		await db.insert(ssoProvider).values({
			id: randomId(),
			providerId: "oidc-acme",
			organizationId,
			userId: inviterId,
			issuer: "https://issuer.example.com",
			domain: "example.com",
		});

		// Invitation was already consumed (user was removed from org, invitation remains accepted)
		await db.insert(invitation).values({
			id: randomId(),
			organizationId,
			email: "returning@example.com",
			role: "member",
			status: "accepted",
			expiresAt: new Date(Date.now() + 60 * 60 * 1000),
			createdAt: new Date(),
			inviterId,
		});

		const ctx = createMockSsoCallbackContext("oidc-acme");
		await expect(ssoIntegration.resolveOrgMembership(userId, ctx)).rejects.toThrow("invite-only");
	});

	test("does not grant access to org B when invitation belongs to a different org A", async () => {
		const userId = await createUser("alice@example.com", randomSlug("alice"));
		const inviterId = await createUser("inviter@example.com", randomSlug("inviter"));

		const orgAId = randomId();
		await db.insert(organization).values({
			id: orgAId,
			name: "Org A",
			slug: randomSlug("org-a"),
			createdAt: new Date(),
		});

		const orgBId = randomId();
		await db.insert(organization).values({
			id: orgBId,
			name: "Org B",
			slug: randomSlug("org-b"),
			createdAt: new Date(),
		});

		// SSO provider belongs to org B
		await db.insert(ssoProvider).values({
			id: randomId(),
			providerId: "oidc-org-b",
			organizationId: orgBId,
			userId: inviterId,
			issuer: "https://issuer.example.com",
			domain: "example.com",
		});

		// User has a valid pending invitation, but only for org A — not org B
		await db.insert(invitation).values({
			id: randomId(),
			organizationId: orgAId,
			email: "alice@example.com",
			role: "member",
			status: "pending",
			expiresAt: new Date(Date.now() + 60 * 60 * 1000),
			createdAt: new Date(),
			inviterId,
		});

		const ctx = createMockSsoCallbackContext("oidc-org-b");
		await expect(ssoIntegration.resolveOrgMembership(userId, ctx)).rejects.toThrow("invite-only");
	});
});
