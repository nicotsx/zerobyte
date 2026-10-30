import { eq } from "drizzle-orm";
import { logger } from "@zerobyte/core/node";
import { db } from "../../../db/db";
import { organization, organizationSecretsTable } from "../../../db/schema";
import { toMessage } from "~/server/utils/errors";

const execute = async () => {
	const errors: Array<{ name: string; error: string }> = [];
	const organizations = await db.query.organization.findMany();

	for (const org of organizations) {
		try {
			db.transaction((tx) => {
				const existing = tx.query.organizationSecretsTable
					.findFirst({ where: { organizationId: org.id } })
					.sync();
				const metadata = org.metadata ?? {};
				const legacyResticPassword = metadata.resticPassword;

				if (!existing && typeof legacyResticPassword !== "string") {
					throw new Error("Organization Restic password not found");
				}

				if (typeof legacyResticPassword === "string") {
					tx.insert(organizationSecretsTable)
						.values({ organizationId: org.id, resticPassword: legacyResticPassword })
						.onConflictDoNothing()
						.run();

					const { resticPassword: _resticPassword, ...publicMetadata } = metadata;
					tx.update(organization)
						.set({ metadata: Object.keys(publicMetadata).length > 0 ? publicMetadata : null })
						.where(eq(organization.id, org.id))
						.run();
				}
			});
		} catch (error) {
			errors.push({ name: `organization:${org.id}`, error: toMessage(error) });
		}
	}

	logger.info(`Separated recovery secrets for ${organizations.length - errors.length} organizations.`);

	return { success: errors.length === 0, errors };
};

export const v00009 = {
	execute,
	id: "00009-separate-organization-secrets",
	type: "critical" as const,
};
