import { db } from "~/server/db/db";
import { faker } from "@faker-js/faker";
import { repositoriesTable, type RepositoryInsert } from "~/server/db/schema";
import { ensureTestOrganization, TEST_ORG_ID } from "./organization";

export const createTestRepository = async (overrides: Partial<RepositoryInsert> = {}) => {
	await ensureTestOrganization();

	const repository: RepositoryInsert = {
		id: faker.string.alphanumeric(6),
		name: faker.string.alphanumeric(10),
		shortId: faker.string.alphanumeric(6),
		config: {
			path: `/var/lib/zerobyte/repositories/${faker.string.alphanumeric(8)}`,
			backend: "local",
		},
		type: "local",
		organizationId: TEST_ORG_ID,
		...overrides,
	};

	const data = await db.insert(repositoriesTable).values(repository).returning();
	return data[0];
};
