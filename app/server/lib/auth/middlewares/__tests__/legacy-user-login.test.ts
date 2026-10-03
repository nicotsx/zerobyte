import { beforeEach, expect, test } from "vitest";
import { createApp } from "~/server/app";
import { config } from "~/server/core/config";
import { db } from "~/server/db/db";
import { account, member, organization, sessionsTable, usersTable } from "~/server/db/schema";
import { resetPassword } from "~/server/cli/commands/reset-password";

const app = createApp();

beforeEach(async () => {
	await db.delete(sessionsTable);
	await db.delete(member);
	await db.delete(account);
	await db.delete(organization);
	await db.delete(usersTable);
});

test("a legacy user with an overlong password can recover access using the CLI reset", async () => {
	const username = "legacy-admin";
	const oldPassword = "a".repeat(129);
	const newPassword = "a".repeat(128);

	await db.insert(usersTable).values({
		id: Bun.randomUUIDv7(),
		username,
		email: "legacy-admin@example.com",
		name: "Legacy Admin",
		passwordHash: await Bun.password.hash(oldPassword),
	});

	const signIn = (password: string) =>
		app.request("/api/auth/sign-in/username", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: config.baseUrl,
			},
			body: JSON.stringify({ username, password }),
		});

	const rejectedResponse = await signIn(oldPassword);

	expect(rejectedResponse.status).toBe(400);
	expect(await rejectedResponse.json()).toMatchObject({ code: "PASSWORD_TOO_LONG" });

	await resetPassword(username, newPassword);

	const recoveredResponse = await signIn(newPassword);

	expect(recoveredResponse.status).toBe(200);

	const recoveredUser = await db.query.usersTable.findFirst({ where: { username } });
	expect(await db.query.sessionsTable.findFirst({ where: { userId: recoveredUser?.id } })).toBeDefined();
});

test("a legacy user can sign in through Better Auth during first-login conversion", async () => {
	const username = "legacy-admin";
	const password = "legacy-password";

	await db.insert(usersTable).values({
		id: Bun.randomUUIDv7(),
		username,
		email: "legacy-admin@example.com",
		name: "Legacy Admin",
		passwordHash: await Bun.password.hash(password),
	});

	const response = await app.request("/api/auth/sign-in/username", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: config.baseUrl,
		},
		body: JSON.stringify({ username, password }),
	});

	expect(response.status).toBe(200);

	const convertedUser = await db.query.usersTable.findFirst({ where: { username } });
	expect(convertedUser?.passwordHash).toBeNull();
	expect(await db.query.sessionsTable.findFirst({ where: { userId: convertedUser?.id } })).toBeDefined();
});
