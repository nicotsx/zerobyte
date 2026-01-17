import { db } from "~/server/db/db";
import { faker } from "@faker-js/faker";
import { volumesTable, type VolumeInsert } from "~/server/db/schema";
import { ensureTestOrganization, TEST_ORG_ID } from "./organization";

export const createTestVolume = async (overrides: Partial<VolumeInsert> = {}) => {
	await ensureTestOrganization();

	const volume: VolumeInsert = {
		name: faker.system.fileName(),
		config: {
			backend: "directory",
			path: `/mnt/volumes/${faker.system.fileName()}`,
		},
		status: "mounted",
		autoRemount: true,
		shortId: faker.string.alphanumeric(6),
		type: "directory",
		organizationId: TEST_ORG_ID,
		...overrides,
	};

	const data = await db.insert(volumesTable).values(volume).returning();
	return data[0];
};
