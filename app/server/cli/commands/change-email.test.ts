import { beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/db";
import { account, sessionsTable, usersTable } from "~/server/db/schema";
import { changeEmailForUser, getEmailChangeImpact } from "./change-email";

const randomId = () => Bun.randomUUIDv7();
const randomSlug = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

const insertUser = async (username: string, email: string) => {
	const id = randomId();

	await db.insert(usersTable).values({
		id,
		username,
		name: username,
		email,
	});

	return { id, username, email };
};

const insertCredentialAccount = async (userId: string) => {
	await db.insert(account).values({
		id: randomId(),
		accountId: userId,
		providerId: "credential",
		userId,
		password: randomSlug("hash"),
	});
};

const insertSsoAccount = async (userId: string, providerId: string, accountId = randomSlug("oidc-account")) => {
	await db.insert(account).values({
		id: randomId(),
		accountId,
		providerId,
		userId,
	});

	return accountId;
};

const insertSession = async (userId: string) => {
	await db.insert(sessionsTable).values({
		id: randomId(),
		userId,
		token: randomSlug("token"),
		expiresAt: new Date(Date.now() + 60_000),
	});
};

describe("changeEmailForUser", () => {
	beforeEach(async () => {
		await db.delete(sessionsTable);
		await db.delete(account);
		await db.delete(usersTable);
	});

	test("changes email, deletes linked SSO accounts, and invalidates sessions", async () => {
		const user = await insertUser("alice", "alice@example.com");
		await insertCredentialAccount(user.id);
		await insertSsoAccount(user.id, "oidc-google");
		await insertSession(user.id);

		const result = await changeEmailForUser("alice", "new-alice@example.com");

		expect(result).toEqual({
			previousEmail: "alice@example.com",
			updatedEmail: "new-alice@example.com",
			deletedSsoAccounts: 1,
		});

		const [updatedUser] = await db
			.select({ email: usersTable.email })
			.from(usersTable)
			.where(eq(usersTable.id, user.id));
		expect(updatedUser?.email).toBe("new-alice@example.com");

		const remainingAccounts = await db
			.select({ providerId: account.providerId })
			.from(account)
			.where(eq(account.userId, user.id));

		expect(remainingAccounts).toEqual([{ providerId: "credential" }]);

		const sessions = await db
			.select({ id: sessionsTable.id })
			.from(sessionsTable)
			.where(eq(sessionsTable.userId, user.id));
		expect(sessions).toHaveLength(0);
	});

	test("fails when the user has no credential account", async () => {
		const user = await insertUser("bob", "bob@example.com");
		await insertSsoAccount(user.id, "oidc-github");

		await expect(changeEmailForUser("bob", "new-bob@example.com")).rejects.toThrow("no credential account");
	});

	test("fails when the target email is already in use", async () => {
		const firstUser = await insertUser("carol", "carol@example.com");
		await insertCredentialAccount(firstUser.id);

		const secondUser = await insertUser("dave", "dave@example.com");
		await insertCredentialAccount(secondUser.id);

		await expect(changeEmailForUser("carol", "dave@example.com")).rejects.toThrow("already in use");
	});

	test("returns linked SSO accounts when previewing impact", async () => {
		const user = await insertUser("eve", "eve@example.com");
		await insertCredentialAccount(user.id);
		await insertSsoAccount(user.id, "oidc-google", "google-eve");
		await insertSsoAccount(user.id, "oidc-github", "github-eve");

		const impact = await getEmailChangeImpact("eve", "eve-new@example.com");

		expect(impact.ssoAccounts).toEqual([
			{ providerId: "oidc-github", accountId: "github-eve" },
			{ providerId: "oidc-google", accountId: "google-eve" },
		]);
	});

	test("returns no SSO warning candidates when user has no SSO accounts", async () => {
		const user = await insertUser("frank", "frank@example.com");
		await insertCredentialAccount(user.id);

		const impact = await getEmailChangeImpact("frank", "frank-new@example.com");

		expect(impact.ssoAccounts).toEqual([]);
	});

	test("rejects changing to the same email and leaves SSO accounts and sessions unchanged", async () => {
		const user = await insertUser("grace", "grace@example.com");
		await insertCredentialAccount(user.id);
		await insertSsoAccount(user.id, "oidc-google", "google-grace");
		await insertSession(user.id);

		await expect(changeEmailForUser("grace", "grace@example.com")).rejects.toThrow("already has email");

		const impact = await getEmailChangeImpact("grace", "grace-different@example.com");
		expect(impact.ssoAccounts).toEqual([{ providerId: "oidc-google", accountId: "google-grace" }]);

		const sessions = await db
			.select({ id: sessionsTable.id })
			.from(sessionsTable)
			.where(eq(sessionsTable.userId, user.id));
		expect(sessions).toHaveLength(1);
	});
});
