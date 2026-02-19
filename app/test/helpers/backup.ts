import { db } from "~/server/db/db";
import { faker } from "@faker-js/faker";
import { backupSchedulesTable, type BackupScheduleInsert } from "~/server/db/schema";
import { createTestOrganization, ensureTestOrganization, TEST_ORG_ID } from "./organization";
import { createTestVolume } from "./volume";
import { createTestRepository } from "./repository";
import { generateShortId } from "~/server/utils/id";

export const createTestBackupSchedule = async (overrides: Partial<BackupScheduleInsert> = {}) => {
	const organizationId = overrides.organizationId ?? TEST_ORG_ID;

	if (organizationId === TEST_ORG_ID) {
		await ensureTestOrganization();
	} else {
		await createTestOrganization({ id: organizationId });
	}

	const volumeId = overrides.volumeId ?? (await createTestVolume({ organizationId })).id;
	const repositoryId = overrides.repositoryId ?? (await createTestRepository({ organizationId })).id;

	const backup: BackupScheduleInsert = {
		name: faker.system.fileName(),
		cronExpression: "0 0 * * *",
		repositoryId,
		volumeId,
		shortId: generateShortId(),
		organizationId,
		...overrides,
	};

	const data = await db.insert(backupSchedulesTable).values(backup).returning();
	return data[0];
};
