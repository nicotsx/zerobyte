import { eq } from "drizzle-orm";
import { db } from "../../db/db";
import { backupScheduleMirrorsTable, repositoriesTable, type Repository } from "../../db/schema";
import { logger } from "../../utils/logger";
import { hasMigrationCheckpoint, recordMigrationCheckpoint } from "./checkpoint";
import { toMessage } from "~/server/utils/errors";
import { safeSpawn } from "~/server/utils/spawn";
import { addCommonArgs, buildEnv, buildRepoUrl, cleanupTemporaryKeys } from "~/server/utils/restic";

const MIGRATION_VERSION = "v0.21.0";

interface MigrationResult {
	success: boolean;
	errors: Array<{ name: string; error: string }>;
}

export class MigrationError extends Error {
	version: string;
	failedItems: Array<{ name: string; error: string }>;

	constructor(version: string, failedItems: Array<{ name: string; error: string }>) {
		const itemNames = failedItems.map((e) => e.name).join(", ");
		super(`Migration ${version} failed for: ${itemNames}`);
		this.version = version;
		this.failedItems = failedItems;
		this.name = "MigrationError";
	}
}

export const retagSnapshots = async () => {
	const alreadyMigrated = await hasMigrationCheckpoint(MIGRATION_VERSION);
	if (alreadyMigrated) {
		logger.debug(`Migration ${MIGRATION_VERSION} already completed, skipping.`);
		return;
	}

	logger.info(`Starting snapshots retagging migration (${MIGRATION_VERSION})...`);

	const result = await migrateSnapshotsToShortIdTag();
	const allErrors = [...result.errors];

	if (allErrors.length > 0) {
		for (const err of allErrors) {
			logger.error(`Migration failure - ${err.name}: ${err.error}`);
		}
		throw new MigrationError(MIGRATION_VERSION, allErrors);
	}

	await recordMigrationCheckpoint(MIGRATION_VERSION);

	logger.info(`Snapshots retagging migration (${MIGRATION_VERSION}) complete.`);
};

const migrateTag = async (
	oldTag: string,
	newTag: string,
	repository: Repository,
	scheduleName: string,
): Promise<string | null> => {
	const repoUrl = buildRepoUrl(repository.config);
	const env = await buildEnv(repository.config);

	const args = ["--repo", repoUrl, "tag", "--tag", oldTag, "--add", newTag, "--remove", oldTag];

	addCommonArgs(args, env);

	logger.info(`Migrating snapshots for schedule '${scheduleName}' from tag '${oldTag}' to '${newTag}'`);
	const res = await safeSpawn({ command: "restic", args, env });
	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic tag failed: ${res.stderr}`);
		return toMessage(res.stderr);
	}

	logger.info(`Migrated snapshots for schedule '${scheduleName}' from tag '${oldTag}' to '${newTag}'`);
	return null;
};

const migrateSnapshotsToShortIdTag = async (): Promise<MigrationResult> => {
	const errors: Array<{ name: string; error: string }> = [];
	const backupSchedules = await db.query.backupSchedulesTable.findMany({});

	for (const schedule of backupSchedules) {
		const oldTag = schedule.id.toString();
		const newTag = schedule.shortId;

		const repository = await db.query.repositoriesTable.findFirst({
			where: eq(repositoriesTable.id, schedule.repositoryId),
		});

		if (!repository) {
			errors.push({ name: `schedule:${schedule.name}`, error: `Associated repository not found` });
			continue;
		}

		const error = await migrateTag(oldTag, newTag, repository, schedule.name);
		if (error) {
			errors.push({ name: `schedule:${schedule.name}`, error });
			continue;
		}

		const mirrors = await db
			.select()
			.from(backupScheduleMirrorsTable)
			.where(eq(backupScheduleMirrorsTable.scheduleId, schedule.id));

		for (const mirror of mirrors) {
			const mirrorRepo = await db.query.repositoriesTable.findFirst({
				where: eq(repositoriesTable.id, mirror.repositoryId),
			});

			if (!mirrorRepo) {
				errors.push({ name: `schedule-mirror:${schedule.name}`, error: `Associated mirror repository not found` });
				continue;
			}

			const mirrorError = await migrateTag(oldTag, newTag, mirrorRepo, `${schedule.name} (mirror)`);
			if (mirrorError) {
				errors.push({ name: `schedule-mirror:${schedule.name}`, error: mirrorError });
			}
		}

		logger.info(`Migrated snapshots for schedule '${schedule.name}' from tag '${oldTag}' to '${newTag}'`);
	}

	return { success: errors.length === 0, errors };
};
