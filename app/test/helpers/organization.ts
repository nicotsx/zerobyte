import { db } from "~/server/db/db";
import { organization, type OrganizationMetadata } from "~/server/db/schema";
import { faker } from "@faker-js/faker";

export const TEST_ORG_ID = "test-org-00000001";

export const createTestOrganization = async (overrides: Partial<typeof organization.$inferInsert> = {}) => {
	const metadata: OrganizationMetadata = {
		resticPassword: "test-encrypted-restic-password",
	};

	const org: typeof organization.$inferInsert = {
		id: TEST_ORG_ID,
		name: "Test Organization",
		slug: `test-org-${faker.string.alphanumeric(6)}`,
		createdAt: new Date(),
		metadata,
		...overrides,
	};

	const existing = await db.query.organization.findFirst({
		where: (o, { eq }) => eq(o.id, org.id ?? TEST_ORG_ID),
	});

	if (existing) {
		return existing;
	}

	const data = await db.insert(organization).values(org).returning();
	return data[0];
};

export const ensureTestOrganization = async () => {
	return createTestOrganization();
};
