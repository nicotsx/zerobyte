import { db } from "~/server/db/db";
import { sessionsTable, usersTable, account } from "~/server/db/schema";
import { hashPassword } from "better-auth/crypto";
import { createHmac } from "node:crypto";

export async function createTestSession() {
	const [existingUser] = await db.select().from(usersTable);

	if (!existingUser) {
		await db.insert(usersTable).values({
			username: "testuser",
			email: "test@test.com",
			name: "Test User",
			id: crypto.randomUUID(),
		});
	}

	const [user] = await db.select().from(usersTable);

	const token = crypto.randomUUID().replace(/-/g, "");
	const sessionId = token;
	const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

	await db.insert(sessionsTable).values({
		id: sessionId,
		userId: user.id,
		expiresAt,
		token: token,
		createdAt: new Date(),
		updatedAt: new Date(),
	});

	// Better Auth signs the token using HMAC-SHA256 with the secret
	// The secret is "test-secret" because we mocked cryptoUtils.deriveSecret
	const signature = createHmac("sha256", "test-secret").update(token).digest("base64");

	const signedToken = `${token}.${signature}`;

	await db
		.insert(account)
		.values({
			userId: user.id,
			accountId: "testuser",
			password: await hashPassword("password123"),
			id: crypto.randomUUID(),
			providerId: "credentials",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.onConflictDoNothing();

	return { token: encodeURIComponent(signedToken), user };
}
