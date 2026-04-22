import { eq } from "drizzle-orm";
import { logger } from "@zerobyte/core/node";
import { db } from "../../../db/db";
import { backupSchedulesTable } from "../../../db/schema";
import { toMessage } from "~/server/utils/errors";

const isIncludePatternEntry = (value: string) => value.startsWith("!") || /[*?[\]]/.test(value);

const execute = async () => {
	const errors: Array<{ name: string; error: string }> = [];
	const schedules = await db.query.backupSchedulesTable.findMany();
	let migratedCount = 0;

	for (const schedule of schedules) {
		if (schedule.includePaths?.length || !schedule.includePatterns?.length) {
			continue;
		}

		try {
			const existingIncludePatterns = schedule.includePatterns ?? [];
			const includePaths = existingIncludePatterns.filter((value) => !isIncludePatternEntry(value));
			if (includePaths.length === 0) {
				continue;
			}

			const includePatterns = existingIncludePatterns.filter(isIncludePatternEntry);

			await db
				.update(backupSchedulesTable)
				.set({
					includePaths,
					includePatterns,
					updatedAt: Date.now(),
				})
				.where(eq(backupSchedulesTable.id, schedule.id));

			migratedCount += 1;
		} catch (error) {
			errors.push({
				name: `backup-schedule:${schedule.id}`,
				error: toMessage(error),
			});
		}
	}

	logger.info(`Migration 00005-split-backup-include-paths updated ${migratedCount} backup schedules.`);

	return { success: errors.length === 0, errors };
};

export const v00005 = {
	execute,
	id: "00005-split-backup-include-paths",
	type: "maintenance" as const,
};
