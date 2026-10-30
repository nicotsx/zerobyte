import { db } from "~/server/db/db";
import { organization, organizationSecretsTable } from "~/server/db/schema";
import { faker } from "@faker-js/faker";

export const TEST_ORG_ID = "test-org-00000001";

export const createTestOrganization = async (overrides: Partial<typeof organization.$inferInsert> = {}) => {
	const legacyMetadata = overrides.metadata as { resticPassword?: string } | undefined;
	const resticPassword = legacyMetadata?.resticPassword ?? "test-encrypted-restic-password";
	const metadata = legacyMetadata ? { ...legacyMetadata, resticPassword: undefined } : undefined;

	const org: typeof organization.$inferInsert = {
		id: TEST_ORG_ID,
		name: "Test Organization",
		slug: `test-org-${faker.string.alphanumeric(6)}`,
		createdAt: new Date(),
		metadata,
		...overrides,
	};
	org.metadata = metadata;

	const existing = await db.query.organization.findFirst({
		where: { id: org.id },
	});

	if (existing) {
		await db
			.insert(organizationSecretsTable)
			.values({ organizationId: existing.id, resticPassword })
			.onConflictDoNothing();
		return existing;
	}

	const data = await db.insert(organization).values(org).returning();
	await db.insert(organizationSecretsTable).values({ organizationId: org.id, resticPassword });
	return data[0];
};

export const ensureTestOrganization = async () => {
	return createTestOrganization();
};
