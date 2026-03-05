import { beforeEach, describe, expect, test } from "bun:test";
import { db, sqlite } from "~/server/db/db";
import { account, invitation, member, organization, sessionsTable, ssoProvider, usersTable } from "~/server/db/schema";
import { ssoService } from "../sso.service";

const DELETE_SSO_PROVIDER_ROLLBACK_TRIGGER = "delete_sso_provider_sessions_abort";

function randomId() {
	return Bun.randomUUIDv7();
}

function randomSlug(prefix: string) {
	return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function escapeSqlLiteral(value: string) {
	return value.replaceAll("'", "''");
}

function dropTrigger(name: string) {
	sqlite.exec(`DROP TRIGGER IF EXISTS ${name};`);
}

async function createUser(email: string) {
	const id = randomId();

	await db.insert(usersTable).values({
		id,
		email,
		name: email.split("@")[0],
		username: randomSlug("user"),
	});

	return id;
}

async function createOrganization(name: string) {
	const id = randomId();

	await db.insert(organization).values({
		id,
		name,
		slug: randomSlug("org"),
		createdAt: new Date(),
	});

	return id;
}

async function createSession(userId: string) {
	await db.insert(sessionsTable).values({
		id: randomId(),
		userId,
		token: randomSlug("token"),
		expiresAt: new Date(Date.now() + 60_000),
	});
}

describe("ssoService.deleteSsoProvider", () => {
	beforeEach(async () => {
		dropTrigger(DELETE_SSO_PROVIDER_ROLLBACK_TRIGGER);
		await db.delete(member);
		await db.delete(account);
		await db.delete(sessionsTable);
		await db.delete(invitation);
		await db.delete(ssoProvider);
		await db.delete(organization);
		await db.delete(usersTable);
	});

	test("does not delete accounts when provider belongs to another organization", async () => {
		const orgA = await createOrganization("Org A");
		const orgB = await createOrganization("Org B");
		const providerOwner = await createUser(`${randomSlug("owner")}@example.com`);
		const accountUser = await createUser(`${randomSlug("member")}@example.com`);

		const providerId = `oidc-${randomSlug("provider")}`;

		await db.insert(ssoProvider).values({
			id: randomId(),
			providerId,
			organizationId: orgB,
			userId: providerOwner,
			issuer: "https://issuer.example.com",
			domain: "example.com",
		});

		await db.insert(account).values({
			id: randomId(),
			accountId: randomSlug("acct"),
			providerId,
			userId: accountUser,
		});

		const deleted = await ssoService.deleteSsoProvider(providerId, orgA);

		expect(deleted).toBe(false);

		const remainingProvider = await db.query.ssoProvider.findFirst({
			where: { providerId },
			columns: { id: true },
		});
		const remainingAccounts = await db.query.account.findMany({
			where: { providerId },
			columns: { id: true },
		});

		expect(remainingProvider).not.toBeUndefined();
		expect(remainingAccounts).toHaveLength(1);
	});

	test("deletes provider and linked accounts in the active organization", async () => {
		const org = await createOrganization("Org A");
		const providerOwner = await createUser(`${randomSlug("owner")}@example.com`);
		const accountUserA = await createUser(`${randomSlug("member-a")}@example.com`);
		const accountUserB = await createUser(`${randomSlug("member-b")}@example.com`);

		const providerId = `oidc-${randomSlug("provider")}`;

		await db.insert(ssoProvider).values({
			id: randomId(),
			providerId,
			organizationId: org,
			userId: providerOwner,
			issuer: "https://issuer.example.com",
			domain: "example.com",
		});

		await db.insert(account).values([
			{
				id: randomId(),
				accountId: randomSlug("acct-a"),
				providerId,
				userId: accountUserA,
			},
			{
				id: randomId(),
				accountId: randomSlug("acct-b"),
				providerId,
				userId: accountUserB,
			},
		]);
		await createSession(accountUserA);
		await createSession(accountUserB);

		const deleted = await ssoService.deleteSsoProvider(providerId, org);

		expect(deleted).toBe(true);

		const remainingProvider = await db.query.ssoProvider.findFirst({
			where: { providerId },
			columns: { id: true },
		});
		const remainingAccounts = await db.query.account.findMany({
			where: { providerId },
			columns: { id: true },
		});
		const remainingSessions = await db.query.sessionsTable.findMany({
			where: { userId: { in: [accountUserA, accountUserB] } },
			columns: { id: true },
		});

		expect(remainingProvider).toBeUndefined();
		expect(remainingAccounts).toHaveLength(0);
		expect(remainingSessions).toHaveLength(0);
	});

	test("deleting a reserved provider id never deletes credential accounts", async () => {
		const org = await createOrganization("Org A");
		const providerOwner = await createUser(`${randomSlug("owner")}@example.com`);
		const credentialUser = await createUser(`${randomSlug("credential")}@example.com`);

		await db.insert(ssoProvider).values({
			id: randomId(),
			providerId: "credential",
			organizationId: org,
			userId: providerOwner,
			issuer: "https://issuer.example.com",
			domain: "example.com",
		});

		await db.insert(account).values({
			id: randomId(),
			accountId: randomSlug("credential-acct"),
			providerId: "credential",
			userId: credentialUser,
		});

		const deleted = await ssoService.deleteSsoProvider("credential", org);

		expect(deleted).toBe(true);

		const remainingProvider = await db.query.ssoProvider.findFirst({
			where: { providerId: "credential" },
			columns: { id: true },
		});
		const remainingAccounts = await db.query.account.findMany({
			where: { providerId: "credential" },
			columns: { id: true },
		});

		expect(remainingProvider).toBeUndefined();
		expect(remainingAccounts).toHaveLength(1);
	});

	test("deleteSsoProvider rolls back account and provider deletion when session revocation fails", async () => {
		const org = await createOrganization("Org A");
		const providerOwner = await createUser(`${randomSlug("owner")}@example.com`);
		const accountUser = await createUser(`${randomSlug("member")}@example.com`);

		const providerId = `oidc-${randomSlug("provider")}`;

		await db.insert(ssoProvider).values({
			id: randomId(),
			providerId,
			organizationId: org,
			userId: providerOwner,
			issuer: "https://issuer.example.com",
			domain: "example.com",
		});

		await db.insert(account).values({
			id: randomId(),
			accountId: randomSlug("acct"),
			providerId,
			userId: accountUser,
		});
		await createSession(accountUser);

		sqlite.exec(`
			CREATE TRIGGER ${DELETE_SSO_PROVIDER_ROLLBACK_TRIGGER}
			BEFORE DELETE ON sessions_table
			WHEN OLD.user_id = '${escapeSqlLiteral(accountUser)}'
			BEGIN
				SELECT RAISE(ABORT, 'forced deleteSsoProvider rollback');
			END;
		`);

		try {
			await expect(ssoService.deleteSsoProvider(providerId, org)).rejects.toThrow("forced deleteSsoProvider rollback");
		} finally {
			dropTrigger(DELETE_SSO_PROVIDER_ROLLBACK_TRIGGER);
		}

		const remainingProvider = await db.query.ssoProvider.findFirst({
			where: { providerId },
			columns: { id: true },
		});
		const remainingAccounts = await db.query.account.findMany({
			where: { providerId },
			columns: { id: true },
		});
		const remainingSessions = await db.query.sessionsTable.findMany({
			where: { userId: accountUser },
			columns: { id: true },
		});

		expect(remainingProvider).not.toBeUndefined();
		expect(remainingAccounts).toHaveLength(1);
		expect(remainingSessions).toHaveLength(1);
	});
});
