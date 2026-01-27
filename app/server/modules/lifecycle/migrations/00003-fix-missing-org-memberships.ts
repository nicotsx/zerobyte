import { eq } from "drizzle-orm";
import { db } from "../../../db/db";
import { organization, member } from "../../../db/schema";
import { logger } from "../../../utils/logger";
import { toMessage } from "~/server/utils/errors";
import { cryptoUtils } from "~/server/utils/crypto";
import { RESTIC_PASS_FILE } from "~/server/core/constants";

const execute = async () => {
	const errors: Array<{ name: string; error: string }> = [];

	try {
		const allUsers = await db.query.usersTable.findMany({
			with: {
				members: true,
			},
		});

		const usersWithoutOrg = allUsers.filter((user) => user.members.length === 0);

		if (usersWithoutOrg.length === 0) {
			logger.info("No users found without organization memberships");
			return { success: true, errors: [] };
		}

		logger.info(`Found ${usersWithoutOrg.length} user(s) without organization memberships`);

		const legacyPassword = (await Bun.file(RESTIC_PASS_FILE).text()).trim();
		if (!legacyPassword) {
			throw new Error("Legacy restic passfile is empty");
		}

		for (const user of usersWithoutOrg) {
			try {
				await db.transaction(async (tx) => {
					const orgId = `default-org-${user.id}`;
					const slug = user.email.split("@")[0] + "-" + Math.random().toString(36).slice(-4);

					// Check if an organization with this ID already exists
					const existingOrg = await tx.query.organization.findFirst({
						where: eq(organization.id, orgId),
					});

					if (!existingOrg) {
						const metadata = {
							resticPassword: await cryptoUtils.sealSecret(legacyPassword),
						};

						await tx.insert(organization).values({
							id: orgId,
							name: `${user.name}'s Workspace`,
							slug: slug,
							createdAt: new Date(),
							metadata,
						});

						logger.info(`Created organization '${user.name}'s Workspace' for user '${user.username}'`);
					}

					await tx.insert(member).values({
						id: `default-mem-${user.id}`,
						organizationId: orgId,
						userId: user.id,
						role: user.role === "admin" ? "owner" : "owner",
						createdAt: new Date(),
					});

					logger.info(`Created member record for user '${user.username}' in organization '${orgId}'`);
				});
			} catch (err) {
				const errorMsg = toMessage(err);
				logger.error(`Failed to fix user '${user.username}': ${errorMsg}`);
				errors.push({ name: `user:${user.username}`, error: errorMsg });
			}
		}

		const fixed = usersWithoutOrg.length - errors.length;
		logger.info(`Fixed ${fixed} user(s) without organization memberships`);

		return { success: errors.length === 0, errors };
	} catch (err) {
		const errorMsg = toMessage(err);
		logger.error(`Migration failed: ${errorMsg}`);
		return { success: false, errors: [{ name: "migration", error: errorMsg }] };
	}
};

export const v00003 = {
	execute,
	id: "00003-fix-missing-org-memberships",
	type: "critical" as const,
};
