import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/db";
import { account, usersTable, member, organization } from "~/server/db/schema";
import type { AuthMiddlewareContext } from "../auth";
import { UnauthorizedError } from "http-errors-enhanced";
import { cryptoUtils } from "~/server/utils/crypto";

export const convertLegacyUserOnFirstLogin = async (ctx: AuthMiddlewareContext) => {
	const { path, body } = ctx;

	if (path !== "/sign-in/username") {
		return;
	}

	const legacyUser = await db.query.usersTable.findFirst({
		where: {
			AND: [{ username: body.username.trim().toLowerCase() }, { passwordHash: { NOT: "" } }],
		},
	});

	if (legacyUser) {
		const isValid = await Bun.password.verify(body.password, legacyUser.passwordHash ?? "");

		if (isValid) {
			await db.transaction(async (tx) => {
				const newUserId = crypto.randomUUID();
				const accountId = crypto.randomUUID();

				const oldMembership = await tx.query.member.findFirst({
					where: { userId: legacyUser.id },
					with: {
						organization: true,
					},
				});

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

				// Migrate organization membership to the new user
				// The old membership was cascade-deleted when the old user was deleted
				if (oldMembership?.organization) {
					await tx.insert(member).values({
						id: Bun.randomUUIDv7(),
						userId: newUserId,
						organizationId: oldMembership.organization.id,
						role: oldMembership.role,
						createdAt: new Date(),
					});
				} else {
					const orgId = Bun.randomUUIDv7();
					const slug = legacyUser.email.split("@")[0] + "-" + Math.random().toString(36).slice(-4);

					const resticPassword = cryptoUtils.generateResticPassword();
					const metadata = {
						resticPassword: await cryptoUtils.sealSecret(resticPassword),
					};

					await tx.insert(organization).values({
						id: orgId,
						name: `${legacyUser.name}'s Workspace`,
						slug: slug,
						createdAt: new Date(),
						metadata,
					});

					await tx.insert(member).values({
						id: Bun.randomUUIDv7(),
						userId: newUserId,
						organizationId: orgId,
						role: "owner",
						createdAt: new Date(),
					});
				}
			});
		} else {
			throw new UnauthorizedError("Invalid credentials");
		}
	}
};
