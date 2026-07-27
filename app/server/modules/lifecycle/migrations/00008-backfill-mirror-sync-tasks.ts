import { logger } from "@zerobyte/core/node";
import { eq, isNotNull } from "drizzle-orm";
import { db } from "../../../db/db";
import {
	backupScheduleMirrorsTable,
	backupSchedulesTable,
	repositoriesTable,
	tasksTable,
	type TaskInsert,
} from "../../../db/schema";
import { toMessage } from "~/server/utils/errors";

const getTaskStatus = (status: "success" | "error" | "in_progress") => {
	if (status === "success") {
		return "succeeded" as const;
	}
	if (status === "error") {
		return "failed" as const;
	}
	return "stale" as const;
};

const execute = async () => {
	const errors: Array<{ name: string; error: string }> = [];

	try {
		const legacyMirrors = await db
			.select({
				id: backupScheduleMirrorsTable.id,
				lastCopyAt: backupScheduleMirrorsTable.lastCopyAt,
				lastCopyStatus: backupScheduleMirrorsTable.lastCopyStatus,
				lastCopyError: backupScheduleMirrorsTable.lastCopyError,
				scheduleId: backupSchedulesTable.id,
				scheduleShortId: backupSchedulesTable.shortId,
				organizationId: backupSchedulesTable.organizationId,
				mirrorRepositoryShortId: repositoriesTable.shortId,
			})
			.from(backupScheduleMirrorsTable)
			.innerJoin(backupSchedulesTable, eq(backupScheduleMirrorsTable.scheduleId, backupSchedulesTable.id))
			.innerJoin(repositoriesTable, eq(backupScheduleMirrorsTable.repositoryId, repositoriesTable.id))
			.where(isNotNull(backupScheduleMirrorsTable.lastCopyStatus));

		const now = Date.now();

		const tasks: TaskInsert[] = legacyMirrors.flatMap((mirror) => {
			if (!mirror.lastCopyStatus) {
				throw new Error(`Legacy mirror ${mirror.id} has no copy status`);
			}

			const status = getTaskStatus(mirror.lastCopyStatus);
			if (status !== "stale" && mirror.lastCopyAt === null) {
				return [];
			}

			const finishedAt = status === "stale" ? now : mirror.lastCopyAt;
			if (finishedAt === null) {
				return [];
			}

			const result = status === "succeeded" ? { kind: "mirrorSync" } : null;
			let error = mirror.lastCopyError;
			if (status === "stale" && !error) {
				error = "Mirror synchronization was interrupted before task tracking was introduced";
			}

			return [
				{
					id: `legacy-mirror-sync:${mirror.id}`,
					organizationId: mirror.organizationId,
					kind: "mirrorSync",
					status,
					resourceType: "backup_schedule",
					resourceId: mirror.scheduleShortId,
					operationKey: mirror.mirrorRepositoryShortId,
					targetAgentId: null,
					input: {
						kind: "mirrorSync",
						scheduleId: mirror.scheduleId,
						scheduleShortId: mirror.scheduleShortId,
						mirrorRepositoryId: mirror.mirrorRepositoryShortId,
					},
					progress: null,
					result,
					error,
					cancellationRequested: false,
					createdAt: finishedAt,
					startedAt: null,
					updatedAt: finishedAt,
					finishedAt,
				},
			];
		});

		if (tasks.length > 0) {
			await db.insert(tasksTable).values(tasks).onConflictDoNothing({ target: tasksTable.id });
		}

		logger.info(`Migration 00008-backfill-mirror-sync-tasks processed ${tasks.length} mirror statuses.`);
	} catch (error) {
		errors.push({
			name: "mirror-sync-task-backfill",
			error: toMessage(error),
		});
	}

	return { success: errors.length === 0, errors };
};

export const v00008 = {
	execute,
	id: "00008-backfill-mirror-sync-tasks",
	type: "critical" as const,
};
