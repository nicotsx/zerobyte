import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/db";
import { account, usersTable, member, organization } from "~/server/db/schema";
import type { AuthMiddlewareContext } from "~/server/lib/auth";
import { UnauthorizedError } from "http-errors-enhanced";
import { normalizeUsername } from "~/lib/username";
import { buildDefaultOrganizationData, type DefaultOrganizationData } from "../helpers/create-default-org";

export const convertLegacyUserOnFirstLogin = async (ctx: AuthMiddlewareContext) => {
	const { path, body } = ctx;

	if (path !== "/sign-in/username") {
		return;
	}

	const legacyUser = await db.query.usersTable.findFirst({
		where: {
			AND: [
				{ username: normalizeUsername(body.username) },
				{ passwordHash: { NOT: "" } },
				{ passwordHash: { isNotNull: true } },
			],
		},
	});

	if (legacyUser) {
		const isValid = await Bun.password.verify(body.password, legacyUser.passwordHash ?? "");

		if (isValid) {
			const newUserId = crypto.randomUUID();
			const accountId = crypto.randomUUID();

			const oldMembership = await db.query.member.findFirst({
				where: { userId: legacyUser.id },
				with: {
					organization: true,
				},
			});

			const passwordHash = await hashPassword(body.password);

			let newOrganizationData: DefaultOrganizationData | null = null;

			if (!oldMembership?.organization) {
				newOrganizationData = await buildDefaultOrganizationData(legacyUser);
			}

			db.transaction((tx) => {
				tx.delete(usersTable).where(eq(usersTable.id, legacyUser.id)).run();

				tx.insert(usersTable)
					.values({
						id: newUserId,
						username: legacyUser.username,
						email: legacyUser.email,
						name: legacyUser.name,
						hasDownloadedResticPassword: legacyUser.hasDownloadedResticPassword,
						emailVerified: false,
						role: "admin", // In legacy system, the only user is an admin
					})
					.run();

				tx.insert(account)
					.values({
						id: accountId,
						providerId: "credential",
						accountId: legacyUser.username,
						userId: newUserId,
						password: passwordHash,
						createdAt: new Date(),
					})
					.run();

				// Migrate organization membership to the new user
				// The old membership was cascade-deleted when the old user was deleted
				if (oldMembership?.organization) {
					tx.insert(member)
						.values({
							id: Bun.randomUUIDv7(),
							userId: newUserId,
							organizationId: oldMembership.organization.id,
							role: oldMembership.role,
							createdAt: new Date(),
						})
						.run();
				} else if (newOrganizationData) {
					tx.insert(organization).values(newOrganizationData).run();

					tx.insert(member)
						.values({
							id: Bun.randomUUIDv7(),
							userId: newUserId,
							organizationId: newOrganizationData.id,
							role: "owner",
							createdAt: new Date(),
						})
						.run();
				}
			});
		} else {
			throw new UnauthorizedError("Invalid credentials");
		}
	}
};
