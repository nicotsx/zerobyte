import { beforeEach, expect, test } from "vitest";
import { createApp } from "~/server/app";
import { config } from "~/server/core/config";
import { db } from "~/server/db/db";
import { account, member, organization, sessionsTable, usersTable } from "~/server/db/schema";

const app = createApp();

beforeEach(async () => {
	await db.delete(sessionsTable);
	await db.delete(member);
	await db.delete(account);
	await db.delete(organization);
	await db.delete(usersTable);
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
