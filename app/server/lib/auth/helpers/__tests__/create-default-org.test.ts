import { beforeEach, describe, expect, test } from "bun:test";
import type { GenericEndpointContext } from "@better-auth/core";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/db";
import { account, invitation, member, organization, ssoProvider, usersTable } from "~/server/db/schema";
import { createUserDefaultOrg } from "../create-default-org";

function createMockContext(path: string, params: Record<string, string> = {}): GenericEndpointContext {
	return {
		path,
		body: {},
		query: {},
		headers: new Headers(),
		request: new Request(`http://localhost:3000${path}`),
		params,
		method: "POST",
		context: {} as GenericEndpointContext["context"],
	} as GenericEndpointContext;
}

function createMockSsoCallbackContext(providerId: string): GenericEndpointContext {
	return createMockContext(`/sso/callback/${providerId}`, { providerId });
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

describe("createUserDefaultOrg", () => {
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
		const membership = await createUserDefaultOrg(invitedUserId, ctx);

		expect(membership.organizationId).toBe(organizationId);
		expect(membership.role).toBe("member");

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
		expect(createUserDefaultOrg(userId, ctx)).rejects.toThrow("invite-only");
	});

	test("returns existing membership without creating another workspace", async () => {
		const userId = await createUser("existing-member@example.com", randomSlug("existing-member"));
		const organizationId = randomId();

		await db.insert(organization).values({
			id: organizationId,
			name: "Existing Org",
			slug: randomSlug("existing"),
			createdAt: new Date(),
		});

		await db.insert(member).values({
			id: randomId(),
			userId,
			organizationId,
			role: "owner",
			createdAt: new Date(),
		});

		const membership = await createUserDefaultOrg(userId, null);

		expect(membership.organizationId).toBe(organizationId);
		expect(membership.role).toBe("owner");

		const memberships = await db.select().from(member).where(eq(member.userId, userId));
		expect(memberships.length).toBe(1);

		const organizations = await db.select().from(organization);
		expect(organizations.length).toBe(1);
	});

	test("creates personal workspace for non-SSO flows", async () => {
		const userId = await createUser("local-user@example.com", randomSlug("local-user"));

		const membership = await createUserDefaultOrg(userId, null);

		expect(membership.role).toBe("owner");
		expect(membership.organization.name).toContain("Workspace");
	});
});
