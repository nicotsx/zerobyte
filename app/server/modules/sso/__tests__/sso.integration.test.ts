import { beforeEach, describe, expect, test } from "bun:test";
import type { GenericEndpointContext } from "better-auth";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/db";
import { account, invitation, member, organization, ssoProvider, usersTable } from "~/server/db/schema";
import { ssoIntegration } from "../sso.integration";
import { ensureDefaultOrg } from "~/server/lib/auth/helpers/create-default-org";

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

async function createUserWithCredentialAccount(email: string, username: string) {
	const userId = await createUser(email, username);

	await db.insert(account).values({
		id: randomId(),
		accountId: username,
		providerId: "credential",
		userId,
		password: "test-password-hash",
		createdAt: new Date(),
		updatedAt: new Date(),
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

	test("keeps invited org assignment when session context loses providerId after user creation", async () => {
		const userId = await createUser("alice@example.com", randomSlug("alice"));
		const inviterId = await createUser("inviter@example.com", randomSlug("inviter"));
		const invitedOrgId = randomId();

		await db.insert(organization).values({
			id: invitedOrgId,
			name: "Acme Corp",
			slug: randomSlug("acme"),
			createdAt: new Date(),
		});

		await db.insert(ssoProvider).values({
			id: randomId(),
			providerId: "oidc-acme",
			organizationId: invitedOrgId,
			userId: inviterId,
			issuer: "https://issuer.example.com",
			domain: "example.com",
		});

		await db.insert(invitation).values({
			id: randomId(),
			organizationId: invitedOrgId,
			email: "alice@example.com",
			role: "member",
			status: "pending",
			expiresAt: new Date(Date.now() + 60 * 60 * 1000),
			createdAt: new Date(),
			inviterId,
		});

		const user = await db.query.usersTable.findFirst({ where: { id: userId } });
		if (!user) {
			throw new Error("Expected user to exist");
		}

		await ssoIntegration.onUserCreated(user, createMockSsoCallbackContext("oidc-acme"));

		const membership = await ensureDefaultOrg(userId);

		expect(membership.organizationId).toBe(invitedOrgId);

		const [updatedInvitation] = await db.select().from(invitation).where(eq(invitation.organizationId, invitedOrgId));
		expect(updatedInvitation.status).toBe("accepted");
	});
});

describe("ssoIntegration.canLinkSsoAccount", () => {
	beforeEach(async () => {
		await db.delete(member);
		await db.delete(account);
		await db.delete(invitation);
		await db.delete(ssoProvider);
		await db.delete(organization);
		await db.delete(usersTable);
	});

	async function setupOrgWithProvider(providerId: string, autoLinkMatchingEmails = false) {
		const orgId = randomId();
		const ownerId = await createUser(`owner-${randomSlug("u")}@example.com`, randomSlug("owner"));
		await db.insert(organization).values({ id: orgId, name: "Acme", slug: randomSlug("acme"), createdAt: new Date() });
		await db.insert(ssoProvider).values({
			id: randomId(),
			providerId,
			organizationId: orgId,
			userId: ownerId,
			issuer: "https://issuer.example.com",
			domain: "example.com",
			autoLinkMatchingEmails,
		});
		return { orgId, ownerId };
	}

	const autoLinkingStates = [false, true] as const;

	test("allows linking for a user who is already a member of the org", async () => {
		const { orgId } = await setupOrgWithProvider("oidc-acme");
		const userId = await createUserWithCredentialAccount("alice@example.com", randomSlug("alice"));
		await db.insert(member).values({
			id: randomId(),
			userId,
			organizationId: orgId,
			role: "member",
			createdAt: new Date(),
		});

		const allowed = await ssoIntegration.canLinkSsoAccount(userId, "oidc-acme");

		expect(allowed).toBe(true);
	});

	for (const autoLinkingEnabled of autoLinkingStates) {
		test(`allows linking for a new SSO user with a valid pending invitation (auto-linking ${autoLinkingEnabled ? "enabled" : "disabled"})`, async () => {
			const providerId = `oidc-acme-${autoLinkingEnabled ? "on" : "off"}`;
			const { orgId, ownerId } = await setupOrgWithProvider(providerId, autoLinkingEnabled);
			const userId = await createUser("alice@example.com", randomSlug("alice"));
			await db.insert(invitation).values({
				id: randomId(),
				organizationId: orgId,
				email: "alice@example.com",
				role: "member",
				status: "pending",
				expiresAt: new Date(Date.now() + 60 * 60 * 1000),
				createdAt: new Date(),
				inviterId: ownerId,
			});

			const allowed = await ssoIntegration.canLinkSsoAccount(userId, providerId);

			expect(allowed).toBe(true);
		});

		test(`blocks linking for an existing user account even with a pending invitation (auto-linking ${autoLinkingEnabled ? "enabled" : "disabled"})`, async () => {
			const providerId = `oidc-acme-${autoLinkingEnabled ? "on" : "off"}`;
			const { orgId, ownerId } = await setupOrgWithProvider(providerId, autoLinkingEnabled);
			const userId = await createUserWithCredentialAccount("alice@example.com", randomSlug("alice"));
			await db.insert(invitation).values({
				id: randomId(),
				organizationId: orgId,
				email: "alice@example.com",
				role: "member",
				status: "pending",
				expiresAt: new Date(Date.now() + 60 * 60 * 1000),
				createdAt: new Date(),
				inviterId: ownerId,
			});

			const allowed = await ssoIntegration.canLinkSsoAccount(userId, providerId);

			expect(allowed).toBe(false);
		});
	}

	test("blocks linking for a user with no membership and no invitation in the org", async () => {
		await setupOrgWithProvider("oidc-acme");
		const aliceId = await createUserWithCredentialAccount("alice@example.com", randomSlug("alice"));

		const allowed = await ssoIntegration.canLinkSsoAccount(aliceId, "oidc-acme");

		expect(allowed).toBe(false);
	});

	test("blocks linking when the user only has an invitation to a different org", async () => {
		const { ownerId } = await setupOrgWithProvider("oidc-acme");
		const otherOrgId = randomId();
		await db
			.insert(organization)
			.values({ id: otherOrgId, name: "Other", slug: randomSlug("other"), createdAt: new Date() });
		const aliceId = await createUserWithCredentialAccount("alice@example.com", randomSlug("alice"));
		await db.insert(invitation).values({
			id: randomId(),
			organizationId: otherOrgId,
			email: "alice@example.com",
			role: "member",
			status: "pending",
			expiresAt: new Date(Date.now() + 60 * 60 * 1000),
			createdAt: new Date(),
			inviterId: ownerId,
		});

		const allowed = await ssoIntegration.canLinkSsoAccount(aliceId, "oidc-acme");

		expect(allowed).toBe(false);
	});

	test("blocks linking when the user's invitation to the org has expired", async () => {
		const { orgId, ownerId } = await setupOrgWithProvider("oidc-acme");
		const aliceId = await createUserWithCredentialAccount("alice@example.com", randomSlug("alice"));
		await db.insert(invitation).values({
			id: randomId(),
			organizationId: orgId,
			email: "alice@example.com",
			role: "member",
			status: "pending",
			expiresAt: new Date(Date.now() - 60 * 60 * 1000), // expired
			createdAt: new Date(),
			inviterId: ownerId,
		});

		const allowed = await ssoIntegration.canLinkSsoAccount(aliceId, "oidc-acme");

		expect(allowed).toBe(false);
	});
});
