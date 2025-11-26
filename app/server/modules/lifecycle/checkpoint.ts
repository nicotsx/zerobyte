import { eq, sql } from "drizzle-orm";
import { db } from "../../db/db";
import { appMetadataTable, usersTable } from "../../db/schema";
import { logger } from "../../utils/logger";
import { REQUIRED_MIGRATIONS } from "~/server/core/constants";

const MIGRATION_KEY_PREFIX = "migration:";

export const recordMigrationCheckpoint = async (version: string): Promise<void> => {
	const key = `${MIGRATION_KEY_PREFIX}${version}`;
	const now = Math.floor(Date.now() / 1000);

	await db
		.insert(appMetadataTable)
		.values({
			key,
			value: JSON.stringify({ completedAt: new Date().toISOString() }),
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: appMetadataTable.key,
			set: {
				value: JSON.stringify({ completedAt: new Date().toISOString() }),
				updatedAt: now,
			},
		});

	logger.info(`Recorded migration checkpoint for ${version}`);
};

export const hasMigrationCheckpoint = async (version: string): Promise<boolean> => {
	const key = `${MIGRATION_KEY_PREFIX}${version}`;
	const result = await db.query.appMetadataTable.findFirst({
		where: eq(appMetadataTable.key, key),
	});
	return result !== undefined;
};

export const validateRequiredMigrations = async (requiredVersions: string[]): Promise<void> => {
	const userCount = await db.select({ count: sql<number>`count(*)` }).from(usersTable);
	const isFreshInstall = userCount[0]?.count === 0;

	if (isFreshInstall) {
		logger.info("Fresh installation detected, skipping migration checkpoint validation.");

		for (const version of requiredVersions) {
			const hasCheckpoint = await hasMigrationCheckpoint(version);
			if (!hasCheckpoint) {
				await recordMigrationCheckpoint(version);
			}
		}

		return;
	}

	for (const version of requiredVersions) {
		const hasCheckpoint = await hasMigrationCheckpoint(version);
		if (!hasCheckpoint) {
			logger.error(`
================================================================================
MIGRATION ERROR: Required migration ${version} has not been run.

You are attempting to start a version of Zerobyte that requires migration
checkpoints from previous versions. This typically happens when you skip
versions during an upgrade.

To fix this:
1. First upgrade to version ${version} and run the application once
2. Validate that everything is still working correctly
3. Then upgrade to the current version

================================================================================
`);
			process.exit(1);
		}
	}
};

export const getMigrationCheckpoints = async (): Promise<{ version: string; completedAt: string }[]> => {
	const results = await db.query.appMetadataTable.findMany({
		where: (table, { like }) => like(table.key, `${MIGRATION_KEY_PREFIX}%`),
	});

	return results.map((r) => ({
		version: r.key.replace(MIGRATION_KEY_PREFIX, ""),
		completedAt: JSON.parse(r.value).completedAt,
	}));
};
