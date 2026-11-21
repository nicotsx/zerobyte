import { beforeEach, describe, expect, test } from "vitest";
import type { GenericEndpointContext } from "better-auth";
import { eq } from "drizzle-orm";
import { db, sqlite } from "~/server/db/db";
import {
	account,
	invitation,
	member,
	organization,
	sessionsTable,
	ssoProvider,
	usersTable,
	verification,
} from "~/server/db/schema";
import { saveSsoAccountLink, startSsoAccountLink } from "../sso-account-link";
import { ssoIntegration } from "../sso.integration";
import { ensureDefaultOrg } from "~/server/lib/auth/helpers/create-default-org";
import { SSO_INVITATION_INTENT_COOKIE, ssoService } from "../sso.service";

function createMockSsoCallbackContext(providerId: string, cookie?: string): GenericEndpointContext {
	const headers = new Headers();
	if (cookie) {
		headers.set("cookie", cookie);
	}

	return {
		path: `/sso/callback/${providerId}`,
		body: {},
		query: {},
		headers,
		request: new Request(`http://localhost:3000/sso/callback/${providerId}`, { headers }),
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
		accountId: userId,
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
		await db.delete(verification);
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

		const updatedInvitations = await db
			.select()
			.from(invitation)
			.where(eq(invitation.organizationId, organizationId));
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
			expiresAt: new Date(Date.now() - 60 * 60 * 1000),
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

		await db.insert(ssoProvider).values({
			id: randomId(),
			providerId: "oidc-org-b",
			organizationId: orgBId,
			userId: inviterId,
			issuer: "https://issuer.example.com",
			domain: "example.com",
		});

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

		const [updatedInvitation] = await db
			.select()
			.from(invitation)
			.where(eq(invitation.organizationId, invitedOrgId));
		expect(updatedInvitation.status).toBe("accepted");
	});
});

describe("ssoIntegration.canLinkSsoAccount", () => {
	beforeEach(async () => {
		await db.delete(member);
		await db.delete(account);
		await db.delete(invitation);
		await db.delete(ssoProvider);
		await db.delete(verification);
		await db.delete(organization);
		await db.delete(usersTable);
	});

	async function setupOrgWithProvider(providerId: string) {
		const orgId = randomId();
		const ownerId = await createUser(`owner-${randomSlug("u")}@example.com`, randomSlug("owner"));
		await db
			.insert(organization)
			.values({ id: orgId, name: "Acme", slug: randomSlug("acme"), createdAt: new Date() });
		await db.insert(ssoProvider).values({
			id: randomId(),
			providerId,
			organizationId: orgId,
			userId: ownerId,
			issuer: "https://issuer.example.com",
			domain: "example.com",
		});
		return { orgId, ownerId };
	}

	test.each([
		{ role: "user", hasPassword: false },
		{ role: "user", hasPassword: true },
		{ role: "admin", hasPassword: true },
	])(
		"requires explicit linking for an existing $role member (password: $hasPassword)",
		async ({ role, hasPassword }) => {
			const providerId = "oidc-acme";
			const { orgId } = await setupOrgWithProvider(providerId);
			const create = hasPassword ? createUserWithCredentialAccount : createUser;
			const userId = await create("alice@example.com", randomSlug("alice"));
			await db.update(usersTable).set({ role }).where(eq(usersTable.id, userId));
			await db.insert(member).values({
				id: randomId(),
				userId,
				organizationId: orgId,
				role: "member",
				createdAt: new Date(),
			});

			const allowed = await ssoIntegration.canLinkSsoAccount(userId, providerId, null);

			expect(allowed).toBe(false);
		},
	);

	test.each([false, true])(
		"requires confirmation for an existing profile with an invitation (password: %s)",
		async (hasPassword) => {
			const providerId = "oidc-acme";
			const { orgId, ownerId } = await setupOrgWithProvider(providerId);
			const create = hasPassword ? createUserWithCredentialAccount : createUser;
			const userId = await create("alice@example.com", randomSlug("alice"));
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

			const allowed = await ssoIntegration.canLinkSsoAccount(
				userId,
				providerId,
				createMockSsoCallbackContext(providerId),
			);

			expect(allowed).toBe(false);
		},
	);

	test("allows an existing account to link only through a matching SSO invitation intent", async () => {
		const { orgId, ownerId } = await setupOrgWithProvider("oidc-primary");
		await db.insert(ssoProvider).values({
			id: randomId(),
			providerId: "oidc-backup",
			organizationId: orgId,
			userId: ownerId,
			issuer: "https://backup-issuer.example.com",
			domain: "example.com",
		});
		const userId = await createUserWithCredentialAccount("alice@example.com", randomSlug("alice"));
		const invitationId = randomId();
		await db.insert(invitation).values({
			id: invitationId,
			organizationId: orgId,
			email: "alice@example.com",
			role: "member",
			status: "pending",
			expiresAt: new Date(Date.now() + 60 * 60 * 1000),
			createdAt: new Date(),
			inviterId: ownerId,
		});
		const token = await ssoService.createInvitationSsoIntent({
			userId,
			invitationId,
			providerId: "oidc-backup",
			organizationId: orgId,
			email: "alice@example.com",
		});
		const cookie = `${SSO_INVITATION_INTENT_COOKIE}=${token}`;

		await expect(
			ssoIntegration.canLinkSsoAccount(
				userId,
				"oidc-primary",
				createMockSsoCallbackContext("oidc-primary", cookie),
			),
		).resolves.toBe(false);
		await expect(
			ssoIntegration.canLinkSsoAccount(
				userId,
				"oidc-backup",
				createMockSsoCallbackContext("oidc-backup", cookie),
			),
		).resolves.toBe(true);
	});

	test("blocks linking for a user with no membership and no invitation in the org", async () => {
		await setupOrgWithProvider("oidc-acme");
		const aliceId = await createUserWithCredentialAccount("alice@example.com", randomSlug("alice"));

		const allowed = await ssoIntegration.canLinkSsoAccount(
			aliceId,
			"oidc-acme",
			createMockSsoCallbackContext("oidc-acme"),
		);

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

		const allowed = await ssoIntegration.canLinkSsoAccount(
			aliceId,
			"oidc-acme",
			createMockSsoCallbackContext("oidc-acme"),
		);

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

		const allowed = await ssoIntegration.canLinkSsoAccount(
			aliceId,
			"oidc-acme",
			createMockSsoCallbackContext("oidc-acme"),
		);

		expect(allowed).toBe(false);
	});
});

async function createPendingAccountLink() {
	const username = randomSlug("sso-link");
	const email = `${username}@example.com`;
	const userId = await createUser(email, username);
	const { organizationId } = await ensureDefaultOrg(userId);

	const providerId = randomSlug("oidc");
	const sessionId = randomId();
	const token = randomId();
	const now = new Date();
	const expiresAt = new Date(now.getTime() + 60_000);
	const providerIdentity = {
		id: randomId(),
		issuer: "https://issuer.example.com",
		clientId: "original-client",
		discoveryEndpoint: "https://issuer.example.com/.well-known/openid-configuration",
	};
	await db.insert(ssoProvider).values({
		id: providerIdentity.id,
		providerId,
		organizationId,
		issuer: providerIdentity.issuer,
		domain: "example.com",
		oidcConfig: { clientId: providerIdentity.clientId, discoveryEndpoint: providerIdentity.discoveryEndpoint },
	});
	await db
		.insert(sessionsTable)
		.values({ id: sessionId, userId, token, activeOrganizationId: organizationId, expiresAt });

	const linkDetails = { userId, email, sessionId, organizationId, providerId };
	expect(await startSsoAccountLink(linkDetails, async () => true)).toBe(true);
	const intent = db.query.verification.findFirst({ where: { value: userId } }).sync();
	expect(intent).toBeDefined();
	if (!intent) throw new Error("Link intent was not created");

	const link = { ...linkDetails, id: intent.id, providerIdentity };
	const binding = { userId, providerId, accountId: randomId(), createdAt: now, updatedAt: now };

	return { link, binding, token };
}

test("a failed SSO account insert rolls back the link intent so it can be retried", async () => {
	const { link, binding, token } = await createPendingAccountLink();
	const { id, providerId, userId } = link;

	sqlite.exec(`
		CREATE TEMP TRIGGER fail_sso_account_link
		BEFORE INSERT ON account
		WHEN NEW.provider_id = '${providerId}'
		BEGIN
			SELECT RAISE(ABORT, 'forced SSO account insert failure');
		END;
	`);
	try {
		expect(() => saveSsoAccountLink(link, binding, token)).toThrow();
	} finally {
		sqlite.exec("DROP TRIGGER fail_sso_account_link");
	}

	expect(db.query.verification.findFirst({ where: { id } }).sync()).toBeDefined();
	expect(db.query.account.findFirst({ where: { providerId } }).sync()).toBeUndefined();

	saveSsoAccountLink(link, binding, token);

	expect(db.query.verification.findFirst({ where: { id } }).sync()).toBeUndefined();
	expect(db.query.account.findFirst({ where: { providerId } }).sync()).toMatchObject({ userId, providerId });
});

test("rejects an SSO link if the provider identity changed before the account write", async () => {
	const { link, binding, token } = await createPendingAccountLink();

	await db
		.update(ssoProvider)
		.set({
			oidcConfig: { clientId: "replacement-client", discoveryEndpoint: link.providerIdentity.discoveryEndpoint },
		})
		.where(eq(ssoProvider.id, link.providerIdentity.id));

	expect(() => saveSsoAccountLink(link, binding, token)).toThrow(
		expect.objectContaining({ body: expect.objectContaining({ code: "ACCOUNT_LINK_REQUIRED" }) }),
	);
	expect(db.query.account.findFirst({ where: { providerId: link.providerId } }).sync()).toBeUndefined();
	expect(db.query.verification.findFirst({ where: { id: link.id } }).sync()).toBeDefined();
});

test("allows an SSO link after a provider domain edit", async () => {
	const { link, binding, token } = await createPendingAccountLink();

	await db
		.update(ssoProvider)
		.set({ domain: "renamed.example.com" })
		.where(eq(ssoProvider.id, link.providerIdentity.id));

	saveSsoAccountLink(link, binding, token);

	expect(db.query.account.findFirst({ where: { providerId: link.providerId } }).sync()).toMatchObject({
		userId: link.userId,
		providerId: link.providerId,
	});
});
