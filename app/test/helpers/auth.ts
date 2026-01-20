import { db } from "~/server/db/db";
import { sessionsTable, usersTable, account, organization, member } from "~/server/db/schema";
import { hashPassword } from "better-auth/crypto";
import { createHmac } from "node:crypto";

export async function createTestSession() {
	const userId = crypto.randomUUID();
	const user = {
		username: `testuser-${userId}`,
		email: `${userId}@test.com`,
		name: "Test User",
		id: userId,
	};
	await db.insert(usersTable).values(user);

	const token = crypto.randomUUID().replace(/-/g, "");
	const sessionId = token;
	const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

	const orgId = crypto.randomUUID();
	await db.insert(organization).values({
		id: orgId,
		name: `Org ${orgId}`,
		slug: `test-org-${orgId}`,
		createdAt: new Date(),
	});

	await db.insert(member).values({
		id: crypto.randomUUID(),
		userId: user.id,
		organizationId: orgId,
		role: "owner",
		createdAt: new Date(),
	});

	await db.insert(sessionsTable).values({
		id: sessionId,
		userId: user.id,
		expiresAt,
		token: token,
		createdAt: new Date(),
		updatedAt: new Date(),
		activeOrganizationId: orgId,
	});

	const signature = createHmac("sha256", "test-secret").update(token).digest("base64");
	const signedToken = `${token}.${signature}`;

	await db
		.insert(account)
		.values({
			userId: user.id,
			accountId: user.username,
			password: await hashPassword("password123"),
			id: crypto.randomUUID(),
			providerId: "credentials",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.onConflictDoNothing();

	return { token: encodeURIComponent(signedToken), user, organizationId: orgId };
}
