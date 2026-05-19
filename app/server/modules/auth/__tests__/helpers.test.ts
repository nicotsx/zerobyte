import { beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "~/server/db/db";
import { account, usersTable } from "~/server/db/schema";
import { createUser, randomId, randomSlug } from "~/test/helpers/user-org";
import { verifyUserPassword } from "../helpers";

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

describe("verifyUserPassword", () => {
	beforeEach(async () => {
		verifyPassword.mockClear();
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
