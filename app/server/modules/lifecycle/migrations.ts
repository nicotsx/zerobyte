import { logger } from "../../utils/logger";
import { v00001 } from "./migrations/00001-retag-snapshots";
import { v00002 } from "./migrations/00002-isolate-restic-passwords";
import { v00003 } from "./migrations/00003-fix-missing-org-memberships";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { appMetadataTable, usersTable } from "../../db/schema";
import { db } from "../../db/db";

const MIGRATION_KEY_PREFIX = "migration:";

const recordMigrationCheckpoint = async (version: string): Promise<void> => {
	const key = `${MIGRATION_KEY_PREFIX}${version}`;
	const now = Date.now();

	await db
		.insert(appMetadataTable)
		.values({ key, value: JSON.stringify({ completedAt: new Date().toISOString() }), createdAt: now, updatedAt: now })
		.onConflictDoUpdate({
			target: appMetadataTable.key,
			set: { value: JSON.stringify({ completedAt: new Date().toISOString() }), updatedAt: now },
		});

	logger.info(`Recorded migration checkpoint for ${version}`);
};

const hasMigrationCheckpoint = async (id: string): Promise<boolean> => {
	const key = `${MIGRATION_KEY_PREFIX}${id}`;
	const result = await db.query.appMetadataTable.findFirst({
		where: eq(appMetadataTable.key, key),
	});
	return result !== undefined;
};

type MigrationEntity = {
	execute: () => Promise<{ success: boolean; errors: Array<{ name: string; error: string }> }>;
	id: string;
	type: "maintenance" | "critical";
	dependsOn?: string[];
};

const registry: MigrationEntity[] = [v00001, v00002, v00003];

export const runMigrations = async () => {
	const userCount = await db.select({ count: sql<number>`count(*)` }).from(usersTable);
	const isFreshInstall = userCount[0]?.count === 0;

	if (isFreshInstall) {
		logger.debug("Fresh installation detected, skipping migration checkpoint validation.");

		for (const migration of registry) {
			const hasCheckpoint = await hasMigrationCheckpoint(migration.id);
			if (!hasCheckpoint) {
				await recordMigrationCheckpoint(migration.id);
			}
		}

		return;
	}

	for (const migration of registry) {
		const alreadyMigrated = await hasMigrationCheckpoint(migration.id);

		if (alreadyMigrated) {
			logger.debug(`Migration ${migration.id} already completed, skipping.`);
			continue;
		}

		if (migration.dependsOn) {
			for (const dep of migration.dependsOn) {
				const depCompleted = await hasMigrationCheckpoint(dep);
				if (!depCompleted) {
					const err = [
						"================================================================================",
						`🚨 MIGRATION ERROR: Migration ${migration.id} depends on migration ${dep}.`,
						"The application cannot start until the required migration has successfully completed.",
						"Please fix the issues and restart the application.",
						"",
						"Seek support by opening an issue on the Zerobyte GitHub repository if you need assistance.",
						"================================================================================",
					];
					err.forEach((line) => logger.error(line));
					process.exit(1);
				}
			}
		}

		logger.info(`Running migration: ${migration.id} (${migration.type})`);
		const result = await migration.execute();
		if (result.success) {
			logger.info(`Migration ${migration.id} completed successfully.`);
			await recordMigrationCheckpoint(migration.id);
		} else {
			logger.error(`Migration ${migration.id} completed with errors: ${result.errors.length} items failed.`);
			for (const err of result.errors) {
				logger.error(`Migration failure - ${err.name}: ${err.error}`);
			}

			if (migration.type === "critical") {
				const err = [
					"================================================================================",
					`🚨 MIGRATION ERROR: Critical migration ${migration.id} failed.`,
					"",
					"The application cannot start until this migration has successfully completed.",
					"",
					"Please fix the issues and restart the application. Seek support by opening an issue",
					"on the Zerobyte GitHub repository if you need assistance.",
					"================================================================================",
				];
				err.forEach((line) => logger.error(line));
				process.exit(1);
			}
		}
	}
};
