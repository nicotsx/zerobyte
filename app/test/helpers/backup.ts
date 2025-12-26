import { db } from "~/server/db/db";
import { faker } from "@faker-js/faker";
import { backupSchedulesTable, type BackupScheduleInsert } from "~/server/db/schema";

export const createTestBackupSchedule = async (overrides: Partial<BackupScheduleInsert> = {}) => {
	const backup: BackupScheduleInsert = {
		name: faker.system.fileName(),
		cronExpression: "0 0 * * *",
		repositoryId: "repo_123",
		volumeId: 1,
		shortId: faker.string.uuid(),
		...overrides,
	};

	const data = await db.insert(backupSchedulesTable).values(backup).returning();
	return data[0];
};
