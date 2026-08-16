import { beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/db";
import { sessionsTable, usersTable } from "~/server/db/schema";
import { changeUsername } from "./change-username";

describe("changeUsername", () => {
	beforeEach(async () => {
		await db.delete(sessionsTable);
		await db.delete(usersTable);
	});

	test("updates all username-derived identity fields and invalidates sessions", async () => {
		const userId = Bun.randomUUIDv7();

		await db.insert(usersTable).values({
			id: userId,
			username: "old_username",
			name: "old_username",
			displayUsername: "old_username",
			email: "old@example.com",
		});
		await db.insert(sessionsTable).values({
			id: Bun.randomUUIDv7(),
			userId,
			token: Bun.randomUUIDv7(),
			expiresAt: new Date(Date.now() + 60_000),
		});

		await changeUsername("old_username", "New_Username");

		const [updatedUser] = await db
			.select({
				username: usersTable.username,
				name: usersTable.name,
				displayUsername: usersTable.displayUsername,
			})
			.from(usersTable)
			.where(eq(usersTable.id, userId));
		expect(updatedUser).toEqual({
			username: "new_username",
			name: "new_username",
			displayUsername: "new_username",
		});

		const sessions = await db
			.select({ id: sessionsTable.id })
			.from(sessionsTable)
			.where(eq(sessionsTable.userId, userId));
		expect(sessions).toHaveLength(0);
	});
});
