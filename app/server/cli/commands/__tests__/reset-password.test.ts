import { beforeEach, describe, expect, test } from "vitest";
import { createApp } from "~/server/app";
import { config } from "~/server/core/config";
import { db } from "~/server/db/db";
import { account, sessionsTable, usersTable } from "~/server/db/schema";
import { resetPassword } from "../reset-password";

const app = createApp();

describe("resetPassword", () => {
	beforeEach(async () => {
		await db.delete(sessionsTable);
		await db.delete(account);
		await db.delete(usersTable);
	});

	test.each([1, 2])(
		"resets %i historical credential rows to one usable password account",
		async (credentialCount) => {
			const userId = Bun.randomUUIDv7();
			await db.insert(usersTable).values({
				id: userId,
				username: "legacy-user",
				email: "legacy@example.com",
				name: "Legacy User",
			});

			await db.insert(account).values(
				[
					{
						id: Bun.randomUUIDv7(),
						accountId: "legacy-user",
						providerId: "credential",
						userId,
						password: "obsolete-hash",
					},
					{
						id: Bun.randomUUIDv7(),
						accountId: "duplicate-legacy-user",
						providerId: "credential",
						userId,
						password: "different-obsolete-hash",
					},
				].slice(0, credentialCount),
			);

			const [externalAccount] = await db
				.insert(account)
				.values({
					id: Bun.randomUUIDv7(),
					accountId: "external-subject",
					providerId: "pocket-id",
					userId,
					accessToken: "external-access-token",
				})
				.returning();

			const otherUserId = Bun.randomUUIDv7();
			await db.insert(usersTable).values({
				id: otherUserId,
				username: "other-user",
				email: "other@example.com",
				name: "Other User",
			});

			const [otherAccount] = await db
				.insert(account)
				.values({
					id: Bun.randomUUIDv7(),
					accountId: otherUserId,
					providerId: "credential",
					userId: otherUserId,
					password: "unrelated-hash",
				})
				.returning();

			await db.insert(sessionsTable).values({
				id: Bun.randomUUIDv7(),
				userId,
				token: "old-session",
				expiresAt: new Date(Date.now() + 60_000),
			});

			const [otherSession] = await db
				.insert(sessionsTable)
				.values({
					id: Bun.randomUUIDv7(),
					userId: otherUserId,
					token: "other-session",
					expiresAt: new Date(Date.now() + 60_000),
				})
				.returning();

			await resetPassword("legacy-user", "replacement-password");

			expect(await db.query.account.findMany({ where: { userId, providerId: "credential" } })).toEqual([
				expect.objectContaining({ accountId: userId }),
			]);
			expect(await db.query.account.findMany({ where: { userId, providerId: "pocket-id" } })).toEqual([
				externalAccount,
			]);
			expect(await db.query.account.findMany({ where: { userId: otherUserId } })).toEqual([otherAccount]);
			expect(await db.query.sessionsTable.findMany({ where: { userId } })).toEqual([]);
			expect(await db.query.sessionsTable.findMany({ where: { userId: otherUserId } })).toEqual([otherSession]);

			const response = await app.request("/api/auth/sign-in/username", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Origin: config.baseUrl,
				},
				body: JSON.stringify({ username: "legacy-user", password: "replacement-password" }),
			});

			expect(response.status).toBe(200);
		},
	);

	test("creates a usable credential account when the user has no password account", async () => {
		const userId = Bun.randomUUIDv7();
		await db.insert(usersTable).values({
			id: userId,
			username: "sso-user",
			email: "sso-user@example.com",
			name: "SSO User",
		});

		await resetPassword("sso-user", "replacement-password");

		const response = await app.request("/api/auth/sign-in/username", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: config.baseUrl,
			},
			body: JSON.stringify({ username: "sso-user", password: "replacement-password" }),
		});

		expect(response.status).toBe(200);
	});
});
