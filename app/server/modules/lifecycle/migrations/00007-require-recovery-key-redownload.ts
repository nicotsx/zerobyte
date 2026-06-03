import { and, eq, inArray } from "drizzle-orm";
import { logger } from "@zerobyte/core/node";
import { db } from "../../../db/db";
import { account, member, usersTable } from "../../../db/schema";
import { toMessage } from "~/server/utils/errors";

const execute = async () => {
	const errors: Array<{ name: string; error: string }> = [];

	try {
		const affectedUsers = await db
			.select({ id: usersTable.id })
			.from(usersTable)
			.innerJoin(account, and(eq(account.userId, usersTable.id), eq(account.providerId, "credential")))
			.innerJoin(member, and(eq(member.userId, usersTable.id), inArray(member.role, ["owner", "admin"])))
			.where(eq(usersTable.hasDownloadedResticPassword, true));
		const affectedUserIds = [...new Set(affectedUsers.map((user) => user.id))];

		if (affectedUserIds.length > 0) {
			await db
				.update(usersTable)
				.set({ hasDownloadedResticPassword: false })
				.where(inArray(usersTable.id, affectedUserIds));
		}

		logger.info(
			`Migration 00007-require-recovery-key-redownload marked ${affectedUserIds.length} users for recovery key re-download.`,
		);
	} catch (error) {
		errors.push({
			name: "recovery-key-redownload",
			error: toMessage(error),
		});
	}

	return { success: errors.length === 0, errors };
};

export const v00007 = {
	execute,
	id: "00007-require-recovery-key-redownload",
	type: "maintenance" as const,
};
