import { db } from "../../../db/db";
import { member } from "../../../db/schema";
import { logger } from "../../../utils/logger";
import { toMessage } from "~/server/utils/errors";

const execute = async () => {
	const errors: Array<{ name: string; error: string }> = [];

	try {
		const allUsers = await db.query.usersTable.findMany({
			where: { role: "admin" },
		});
		const allOrganizations = await db.query.organization.findMany({});

		if (allUsers.length === 0) {
			logger.info("No users found, skipping migration");
			return { success: true, errors };
		}

		if (allOrganizations.length === 0) {
			logger.info("No organizations found, skipping migration");
			return { success: true, errors };
		}

		if (allUsers.length !== 1) {
			logger.info(`Found ${allUsers.length} users, expected exactly 1, skipping migration`);
			return { success: true, errors };
		}

		if (allOrganizations.length !== 1) {
			logger.info(`Found ${allOrganizations.length} organizations, expected exactly 1, skipping migration`);
			return { success: true, errors };
		}

		const user = allUsers[0];
		const org = allOrganizations[0];

		const existingMembers = await db.query.member.findMany({
			where: { userId: user.id },
		});

		if (existingMembers.length > 0) {
			logger.info(`User ${user.username} already belongs to organization(s), skipping migration`);
			return { success: true, errors };
		}

		logger.info(`Assigning user ${user.username} to organization ${org.name}`);

		await db.insert(member).values({
			id: Bun.randomUUIDv7(),
			organizationId: org.id,
			userId: user.id,
			role: "owner",
			createdAt: new Date(),
		});

		logger.info(`Successfully assigned user ${user.username} to organization ${org.name}`);
	} catch (err) {
		errors.push({ name: "assign-organization", error: toMessage(err) });
	}

	return { success: errors.length === 0, errors };
};

export const v00003 = {
	execute,
	id: "00003-assign-organization",
	type: "maintenance" as const,
};
