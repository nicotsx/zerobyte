import { beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/db";
import { account, passkey, usersTable } from "~/server/db/schema";
import { createUser, randomId, randomSlug } from "~/test/helpers/user-org";
import { hasActivePasskeyUser, userHasCredentialPassword, verifyUserPassword } from "../helpers";

const { verifyPassword } = vi.hoisted(() => ({
	verifyPassword: vi.fn(async ({ hash }: { hash: string }) => hash === "credential-password-hash"),
}));

vi.mock("better-auth/crypto", () => ({
	verifyPassword,
}));

async function createAccount({
	password,
	providerId,
	userId,
}: {
	password: string | null;
	providerId: string;
	userId: string;
}) {
	await db.insert(account).values({
		id: randomId(),
		accountId: randomSlug("account"),
		providerId,
		userId,
		password,
	});
}

async function createPasskey(userId: string) {
	await db.insert(passkey).values({
		id: randomId(),
		name: "Test passkey",
		publicKey: randomSlug("public-key"),
		userId,
		credentialID: randomSlug("credential"),
		counter: 0,
		deviceType: "singleDevice",
		backedUp: false,
		transports: "internal",
	});
}

describe("verifyUserPassword", () => {
	beforeEach(async () => {
		verifyPassword.mockClear();
		await db.delete(passkey);
		await db.delete(account);
		await db.delete(usersTable);
	});

	test("verifies against the credential account when the user also has SSO accounts", async () => {
		const userId = await createUser(`${randomSlug("user")}@example.com`);
		await createAccount({ userId, providerId: "oidc-acme", password: null });
		await createAccount({ userId, providerId: "credential", password: "credential-password-hash" });

		const result = await verifyUserPassword({ userId, password: "correct-password" });

		expect(result).toBe(true);
		expect(verifyPassword).toHaveBeenCalledWith({
			password: "correct-password",
			hash: "credential-password-hash",
		});
	});

	test("returns false when the user has no credential password account", async () => {
		const userId = await createUser(`${randomSlug("user")}@example.com`);
		await createAccount({ userId, providerId: "oidc-acme", password: null });

		const result = await verifyUserPassword({ userId, password: "correct-password" });

		expect(result).toBe(false);
		expect(verifyPassword).not.toHaveBeenCalled();
	});
});

describe("userHasCredentialPassword", () => {
	beforeEach(async () => {
		await db.delete(passkey);
		await db.delete(account);
		await db.delete(usersTable);
	});

	test("returns true when the user has a credential account with a password", async () => {
		const userId = await createUser(`${randomSlug("user")}@example.com`);
		await createAccount({ userId, providerId: "credential", password: "credential-password-hash" });

		await expect(userHasCredentialPassword(userId)).resolves.toBe(true);
	});

	test("returns false when the user only has SSO accounts", async () => {
		const userId = await createUser(`${randomSlug("user")}@example.com`);
		await createAccount({ userId, providerId: "oidc-acme", password: null });

		await expect(userHasCredentialPassword(userId)).resolves.toBe(false);
	});

	test("returns false when the credential account has no password", async () => {
		const userId = await createUser(`${randomSlug("user")}@example.com`);
		await createAccount({ userId, providerId: "credential", password: null });

		await expect(userHasCredentialPassword(userId)).resolves.toBe(false);
	});
});

describe("hasActivePasskeyUser", () => {
	beforeEach(async () => {
		await db.delete(passkey);
		await db.delete(account);
		await db.delete(usersTable);
	});

	test("returns true when a non-banned user has a passkey", async () => {
		const userId = await createUser(`${randomSlug("user")}@example.com`);
		await createPasskey(userId);

		await expect(hasActivePasskeyUser()).resolves.toBe(true);
	});

	test("returns false when only banned users have passkeys", async () => {
		const userId = await createUser(`${randomSlug("user")}@example.com`);
		await db.update(usersTable).set({ banned: true }).where(eq(usersTable.id, userId));
		await createPasskey(userId);

		await expect(hasActivePasskeyUser()).resolves.toBe(false);
	});

	test("returns false when no users have passkeys", async () => {
		await createUser(`${randomSlug("user")}@example.com`);

		await expect(hasActivePasskeyUser()).resolves.toBe(false);
	});
});
