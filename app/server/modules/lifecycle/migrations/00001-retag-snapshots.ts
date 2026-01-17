import { eq } from "drizzle-orm";
import { db } from "../../../db/db";
import { backupScheduleMirrorsTable, repositoriesTable, type Repository } from "../../../db/schema";
import { logger } from "../../../utils/logger";
import { toMessage } from "~/server/utils/errors";
import { exec } from "~/server/utils/spawn";
import { addCommonArgs, buildEnv, buildRepoUrl, cleanupTemporaryKeys } from "~/server/utils/restic";

const migrateTag = async (
	oldTag: string,
	newTag: string,
	repository: Repository,
	scheduleName: string,
): Promise<string | null> => {
	const repoUrl = buildRepoUrl(repository.config);
	const env = await buildEnv(repository.config, repository.organizationId);

	const args = ["--repo", repoUrl, "tag", "--tag", oldTag, "--add", newTag, "--remove", oldTag];

	addCommonArgs(args, env);

	logger.info(`Migrating snapshots for schedule '${scheduleName}' from tag '${oldTag}' to '${newTag}'`);
	const res = await exec({ command: "restic", args, env });
	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic tag failed: ${res.stderr}`);
		return toMessage(res.stderr);
	}

	logger.info(`Migrated snapshots for schedule '${scheduleName}' from tag '${oldTag}' to '${newTag}'`);
	return null;
};

const execute = async () => {
	const errors: Array<{ name: string; error: string }> = [];
	const backupSchedules = await db.query.backupSchedulesTable.findMany({});

	for (const schedule of backupSchedules) {
		try {
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
		} catch (err) {
			errors.push({ name: `schedule:${schedule.name}`, error: toMessage(err) });
		}
	}

	return { success: errors.length === 0, errors };
};

export const v00001 = {
	execute,
	id: "00001-retag-snapshots",
	type: "maintenance" as const,
};
