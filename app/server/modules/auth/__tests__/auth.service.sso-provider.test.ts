import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "~/server/db/db";
import { account, invitation, member, organization, ssoProvider, usersTable } from "~/server/db/schema";
import { authService } from "../auth.service";

function randomId() {
	return Bun.randomUUIDv7();
}

function randomSlug(prefix: string) {
	return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
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

describe("authService.deleteSsoProvider", () => {
	beforeEach(async () => {
		await db.delete(member);
		await db.delete(account);
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

		const deleted = await authService.deleteSsoProvider(providerId, orgA);

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

		const deleted = await authService.deleteSsoProvider(providerId, org);

		expect(deleted).toBe(true);

		const remainingProvider = await db.query.ssoProvider.findFirst({
			where: { providerId },
			columns: { id: true },
		});
		const remainingAccounts = await db.query.account.findMany({
			where: { providerId },
			columns: { id: true },
		});

		expect(remainingProvider).toBeUndefined();
		expect(remainingAccounts).toHaveLength(0);
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

		const deleted = await authService.deleteSsoProvider("credential", org);

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
});
