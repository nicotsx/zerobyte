import { db } from "~/server/db/db";
import { faker } from "@faker-js/faker";
import { backupSchedulesTable, type BackupScheduleInsert } from "~/server/db/schema";
import { ensureTestOrganization, TEST_ORG_ID } from "./organization";

export const createTestBackupSchedule = async (overrides: Partial<BackupScheduleInsert> = {}) => {
	await ensureTestOrganization();

	const backup: BackupScheduleInsert = {
		name: faker.system.fileName(),
		cronExpression: "0 0 * * *",
		repositoryId: "repo_123",
		volumeId: 1,
		shortId: faker.string.uuid(),
		organizationId: TEST_ORG_ID,
		...overrides,
	};

	const data = await db.insert(backupSchedulesTable).values(backup).returning();
	return data[0];
};
