import { db } from "~/server/db/db";
import { faker } from "@faker-js/faker";
import { volumesTable, type VolumeInsert } from "~/server/db/schema";
import { readVolume } from "~/server/db/volume";
import { LOCAL_AGENT_ID } from "~/server/modules/agents/constants";
import { ensureTestOrganization, TEST_ORG_ID } from "./organization";
import { generateShortId } from "~/server/utils/id";

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
		shortId: generateShortId(),
		type: "directory",
		agentId: LOCAL_AGENT_ID,
		organizationId: TEST_ORG_ID,
		...overrides,
	};

	const [created] = await db.insert(volumesTable).values(volume).returning();
	if (!created) throw new Error("Failed to create test volume");

	return readVolume(created);
};
