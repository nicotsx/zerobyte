import { hashPassword } from "better-auth/crypto";
import { and, eq, ne } from "drizzle-orm";
import { db } from "~/server/db/db";
import { account, usersTable } from "~/server/db/schema";
import type { AuthMiddlewareContext } from "../auth";
import { UnauthorizedError } from "http-errors-enhanced";

export const convertLegacyUserOnFirstLogin = async (ctx: AuthMiddlewareContext) => {
	const { path, body } = ctx;

	if (path !== "/sign-in/username") {
		return;
	}

	const legacyUser = await db.query.usersTable.findFirst({
		where: and(eq(usersTable.username, body.username.trim().toLowerCase()), ne(usersTable.passwordHash, "")),
	});

	if (legacyUser) {
		const isValid = await Bun.password.verify(body.password, legacyUser.passwordHash ?? "");

		if (isValid) {
			await db.transaction(async (tx) => {
				const newUserId = crypto.randomUUID();
				const accountId = crypto.randomUUID();

				await tx.delete(usersTable).where(eq(usersTable.id, legacyUser.id));

				await tx.insert(usersTable).values({
					id: newUserId,
					username: legacyUser.username,
					email: legacyUser.email,
					name: legacyUser.name,
					hasDownloadedResticPassword: legacyUser.hasDownloadedResticPassword,
					emailVerified: false,
					role: "admin", // In legacy system, the only user is an admin
				});

				await tx.insert(account).values({
					id: accountId,
					providerId: "credential",
					accountId: legacyUser.username,
					userId: newUserId,
					password: await hashPassword(body.password),
					createdAt: new Date(),
				});
			});
		} else {
			throw new UnauthorizedError("Invalid credentials");
		}
	}
};
