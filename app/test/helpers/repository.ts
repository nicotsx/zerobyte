import { db } from "~/server/db/db";
import { faker } from "@faker-js/faker";
import { repositoriesTable, type RepositoryInsert } from "~/server/db/schema";

export const createTestRepository = async (overrides: Partial<RepositoryInsert> = {}) => {
	const repository: RepositoryInsert = {
		id: faker.string.alphanumeric(6),
		name: faker.string.alphanumeric(10),
		shortId: faker.string.alphanumeric(6),
		config: {
			name: "test-repo",
			backend: "local",
		},
		type: "local",
		...overrides,
	};

	const data = await db.insert(repositoriesTable).values(repository).returning();
	return data[0];
};
