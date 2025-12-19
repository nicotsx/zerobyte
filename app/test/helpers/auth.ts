import { authService } from "~/server/modules/auth/auth.service";
import { db } from "~/server/db/db";
import { usersTable, sessionsTable } from "~/server/db/schema";

export async function createTestSession() {
	const [existingUser] = await db.select().from(usersTable);

	if (!existingUser) {
		await authService.register("testadmin", "testpassword");
	}

	const [user] = await db.select().from(usersTable);

	const sessionId = crypto.randomUUID();
	const expiresAt = Date.now() + 1000 * 60 * 60 * 24; // 24 hours

	await db.insert(sessionsTable).values({
		id: sessionId,
		userId: user.id,
		expiresAt,
	});

	return { sessionId, user };
}
