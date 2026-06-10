import { and, eq, inArray } from "drizzle-orm";
import { NotFoundError, BadRequestError, ConflictError } from "http-errors-enhanced";
import { logger } from "@zerobyte/core/node";
import { checkMirrorCompatibility, getIncompatibleMirrorError } from "~/server/utils/backend-compatibility";
import { generateShortId } from "~/server/utils/id";
import { getOrganizationId } from "~/server/core/request-context";
import { asShortId, type ShortId } from "~/server/utils/branded";
import { validateCustomResticParams } from "@zerobyte/core/restic/server";
import { db } from "../../db/db";
import { backupScheduleMirrorsTable, backupScheduleNotificationsTable, backupSchedulesTable } from "../../db/schema";
import { cache, cacheKeys } from "../../utils/cache";
import { repoMutex } from "../../core/repository-mutex";
import { backupExecutor } from "./backup-executor";
import { calculateNextRun, isValidCron } from "./backup.helpers";
import { scheduleQueries } from "./backups.queries";
import type { CreateBackupScheduleBody, UpdateBackupScheduleBody, UpdateScheduleMirrorsBody } from "./backups.dto";
import {
	emitBackupStarted,
	finalizeSuccessfulBackup,
	getBackupProgress,
	handleBackupCancellation,
	handleBackupFailure,
	handleValidationResult,
	updateBackupProgress,
	validateBackupExecution,
} from "./helpers/backup-lifecycle";
import { getScheduleByIdOrShortId } from "./helpers/backup-schedule-lookups";
import { copyToMirrors, runForget, syncSnapshotsToMirror } from "./helpers/backup-maintenance";
import { restic } from "../../core/restic";
import { mirrorQueries } from "./backups.queries";
import { runEffectPromise, toMessage } from "../../utils/errors";
import { Effect } from "effect";
import { taskStore } from "../tasks/tasks.store";
import { createTaskProgressBuffer } from "../tasks/progress-buffer";

const BACKUP_TASK_RESOURCE_TYPE = "backup_schedule";

const tryCancelTask = (
	taskId: string,
	activeTaskResource: { organizationId: string; kind: "backup"; resourceType: string; resourceId: string },
) => {
	try {
		taskStore.requestCancel(taskId);
		return true;
	} catch (error) {
		const currentTask = taskStore.findActiveByResource(activeTaskResource);
		if (!currentTask || currentTask.id !== taskId) {
			return false;
		}

		throw error;
	}
};

const listSchedules = async () => {
	const organizationId = getOrganizationId();
	const schedules = await db.query.backupSchedulesTable.findMany({
		where: { organizationId },
		with: { volume: true, repository: true },
		orderBy: { sortOrder: "asc", id: "asc" },
	});
	return schedules.filter((schedule) => schedule.volume && schedule.repository);
};

const createSchedule = async (data: CreateBackupScheduleBody) => {
	const organizationId = getOrganizationId();
	if (data.cronExpression && !isValidCron(data.cronExpression)) {
		throw new BadRequestError("Invalid cron expression");
	}
	if (data.enabled && !data.cronExpression) {
		throw new BadRequestError("Enabled schedules require a cron expression");
	}

	const existingName = await db.query.backupSchedulesTable.findFirst({
		where: {
			AND: [{ name: data.name }, { organizationId }],
		},
	});

	if (existingName) {
		throw new ConflictError("A backup schedule with this name already exists");
	}

	const volume = await db.query.volumesTable.findFirst({
		where: {
			AND: [
				{ OR: [{ id: Number(data.volumeId) }, { shortId: { eq: asShortId(String(data.volumeId)) } }] },
				{ organizationId },
			],
		},
	});

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	const repository = await db.query.repositoriesTable.findFirst({
		where: {
			AND: [
				{ OR: [{ id: data.repositoryId }, { shortId: { eq: asShortId(data.repositoryId) } }] },
				{ organizationId },
			],
		},
	});

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	if (data.customResticParams && data.customResticParams.length > 0) {
		const paramError = validateCustomResticParams(data.customResticParams);
		if (paramError) throw new BadRequestError(paramError);
	}

	const nextBackupAt = data.cronExpression ? calculateNextRun(data.cronExpression) : null;

	const [newSchedule] = await db
		.insert(backupSchedulesTable)
		.values({
			name: data.name,
			volumeId: volume.id,
			repositoryId: repository.id,
			enabled: data.enabled,
			cronExpression: data.cronExpression,
			retentionPolicy: data.retentionPolicy ?? null,
			excludePatterns: data.excludePatterns ?? [],
			excludeIfPresent: data.excludeIfPresent ?? [],
			includePaths: data.includePaths ?? [],
			includePatterns: data.includePatterns ?? [],
			oneFileSystem: data.oneFileSystem,
			customResticParams: data.customResticParams ?? [],
			backupWebhooks: data.backupWebhooks ?? null,
			nextBackupAt: nextBackupAt,
			shortId: generateShortId(),
			maxRetries: data.maxRetries,
			retryDelay: data.retryDelay,
			organizationId,
		})
		.returning();

	if (!newSchedule) {
		throw new Error("Failed to create backup schedule");
	}

	return newSchedule;
};

const updateSchedule = async (scheduleIdOrShortId: number | string, data: UpdateBackupScheduleBody) => {
	const organizationId = getOrganizationId();
	const schedule = await getScheduleByIdOrShortId(scheduleIdOrShortId);

	if (data.cronExpression && !isValidCron(data.cronExpression)) {
		throw new BadRequestError("Invalid cron expression");
	}
	if ((data.enabled ?? schedule.enabled) && data.cronExpression === "") {
		throw new BadRequestError("Enabled schedules require a cron expression");
	}

	if (data.customResticParams && data.customResticParams.length > 0) {
		const paramError = validateCustomResticParams(data.customResticParams);
		if (paramError) throw new BadRequestError(paramError);
	}

	if (data.name) {
		const existingName = await db.query.backupSchedulesTable.findFirst({
			where: {
				AND: [{ name: data.name }, { NOT: { id: schedule.id } }, { organizationId }],
			},
		});

		if (existingName) {
			throw new ConflictError("A backup schedule with this name already exists");
		}
	}

	const repository = await db.query.repositoriesTable.findFirst({
		where: {
			AND: [
				{ OR: [{ id: data.repositoryId }, { shortId: { eq: asShortId(data.repositoryId) } }] },
				{ organizationId },
			],
		},
	});

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const cronExpression = data.cronExpression ?? schedule.cronExpression;
	const nextBackupAt =
		data.cronExpression === ""
			? null
			: data.cronExpression
				? calculateNextRun(cronExpression)
				: schedule.nextBackupAt;

	const [updated] = await db
		.update(backupSchedulesTable)
		.set({
			...data,
			repositoryId: repository.id,
			backupWebhooks: data.backupWebhooks === undefined ? schedule.backupWebhooks : data.backupWebhooks,
			nextBackupAt,
			updatedAt: Date.now(),
		})
		.where(and(eq(backupSchedulesTable.id, schedule.id), eq(backupSchedulesTable.organizationId, organizationId)))
		.returning();

	if (!updated) {
		throw new Error("Failed to update backup schedule");
	}

	return updated;
};

const deleteSchedule = async (scheduleIdOrShortId: number | string) => {
	const organizationId = getOrganizationId();
	const schedule = await getScheduleByIdOrShortId(scheduleIdOrShortId);

	await db
		.delete(backupSchedulesTable)
		.where(and(eq(backupSchedulesTable.id, schedule.id), eq(backupSchedulesTable.organizationId, organizationId)));
};

const getScheduleForVolume = async (volumeIdOrShortId: number | string) => {
	const organizationId = getOrganizationId();
	const volume = await db.query.volumesTable.findFirst({
		where: {
			AND: [
				{ OR: [{ id: Number(volumeIdOrShortId) }, { shortId: { eq: asShortId(String(volumeIdOrShortId)) } }] },
				{ organizationId },
			],
		},
		columns: { id: true },
	});

	if (!volume) {
		return null;
	}

	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: {
			AND: [{ volumeId: volume.id }, { organizationId }],
		},
		with: { volume: true, repository: true },
	});

	if (schedule && (!schedule.volume || !schedule.repository)) {
		return null;
	}

	return schedule ?? null;
};

const getMirrors = async (scheduleIdOrShortId: number | string) => {
	const schedule = await getScheduleByIdOrShortId(scheduleIdOrShortId);

	const mirrors = await db.query.backupScheduleMirrorsTable.findMany({
		where: {
			scheduleId: schedule.id,
		},
		with: { repository: true },
	});

	return mirrors.map((mirror) => ({
		id: mirror.id,
		scheduleId: schedule.shortId,
		repositoryId: mirror.repository.shortId,
		enabled: mirror.enabled,
		lastCopyAt: mirror.lastCopyAt,
		lastCopyStatus: mirror.lastCopyStatus,
		lastCopyError: mirror.lastCopyError,
		createdAt: mirror.createdAt,
		repository: mirror.repository,
	}));
};

const updateMirrors = async (scheduleIdOrShortId: number | string, data: UpdateScheduleMirrorsBody) => {
	const organizationId = getOrganizationId();
	const schedule = await getScheduleByIdOrShortId(scheduleIdOrShortId);

	const normalizedMirrors = await Promise.all(
		data.mirrors.map(async (mirror) => {
			const repo = await db.query.repositoriesTable.findFirst({
				where: {
					AND: [
						{ OR: [{ id: mirror.repositoryId }, { shortId: { eq: asShortId(mirror.repositoryId) } }] },
						{ organizationId },
					],
				},
			});

			if (!repo) {
				throw new NotFoundError(`Repository ${mirror.repositoryId} not found`);
			}

			if (repo.id === schedule.repositoryId) {
				throw new BadRequestError("Cannot add the primary repository as a mirror");
			}

			const compatibility = await checkMirrorCompatibility(schedule.repository.config, repo.config, repo.id);

			if (!compatibility.compatible) {
				throw new BadRequestError(
					getIncompatibleMirrorError(repo.name, schedule.repository.config.backend, repo.config.backend),
				);
			}

			return { repositoryId: repo.id, enabled: mirror.enabled };
		}),
	);

	const existingMirrors = await db.query.backupScheduleMirrorsTable.findMany({
		where: { scheduleId: schedule.id },
	});

	const existingMirrorsMap = new Map(
		existingMirrors.map((m) => [
			m.repositoryId,
			{ lastCopyAt: m.lastCopyAt, lastCopyStatus: m.lastCopyStatus, lastCopyError: m.lastCopyError },
		]),
	);

	await db.delete(backupScheduleMirrorsTable).where(eq(backupScheduleMirrorsTable.scheduleId, schedule.id));

	if (normalizedMirrors.length > 0) {
		await db.insert(backupScheduleMirrorsTable).values(
			normalizedMirrors.map((mirror) => {
				const existing = existingMirrorsMap.get(mirror.repositoryId);
				return {
					scheduleId: schedule.id,
					repositoryId: mirror.repositoryId,
					enabled: mirror.enabled,
					lastCopyAt: existing?.lastCopyAt ?? null,
					lastCopyStatus: existing?.lastCopyStatus ?? null,
					lastCopyError: existing?.lastCopyError ?? null,
				};
			}),
		);
	}

	return getMirrors(schedule.id);
};

const getMirrorCompatibility = async (scheduleIdOrShortId: number | string) => {
	const organizationId = getOrganizationId();
	const schedule = await getScheduleByIdOrShortId(scheduleIdOrShortId);

	const allRepositories = await db.query.repositoriesTable.findMany({ where: { organizationId } });
	const repos = allRepositories.filter((repo) => repo.id !== schedule.repositoryId);

	const compatibility = await Promise.all(
		repos.map((repo) => checkMirrorCompatibility(schedule.repository.config, repo.config, repo.shortId)),
	);

	return compatibility;
};

const reorderSchedules = async (scheduleShortIds: ShortId[]) => {
	const organizationId = getOrganizationId();
	const uniqueIds = new Set(scheduleShortIds);
	if (uniqueIds.size !== scheduleShortIds.length) {
		throw new BadRequestError("Duplicate schedule IDs in reorder request");
	}

	const existingSchedules = await db.query.backupSchedulesTable.findMany({
		where: { organizationId },
		columns: { id: true, shortId: true },
	});

	const shortIdToId = new Map(existingSchedules.map((s) => [s.shortId, s.id]));

	const scheduleIds: number[] = [];
	for (const shortId of scheduleShortIds) {
		const id = shortIdToId.get(shortId);
		if (id === undefined) {
			throw new NotFoundError(`Backup schedule with short ID ${shortId} not found`);
		}
		scheduleIds.push(id);
	}

	db.transaction((tx) => {
		const now = Date.now();
		for (const [index, scheduleId] of scheduleIds.entries()) {
			tx.update(backupSchedulesTable)
				.set({ sortOrder: index, updatedAt: now })
				.where(
					and(
						eq(backupSchedulesTable.id, scheduleId),
						eq(backupSchedulesTable.organizationId, organizationId),
					),
				)
				.run();
		}
	});
};

const cleanupOrphanedSchedules = async () => {
	const schedules = await db.query.backupSchedulesTable.findMany({
		with: { volume: true, repository: true },
		columns: { id: true },
	});

	const orphanScheduleIds = schedules
		.filter((schedule) => schedule.volume === null || schedule.repository === null)
		.map((schedule) => schedule.id);

	if (orphanScheduleIds.length === 0) {
		return { deletedSchedules: 0 };
	}

	db.transaction((tx) => {
		tx.delete(backupScheduleNotificationsTable)
			.where(inArray(backupScheduleNotificationsTable.scheduleId, orphanScheduleIds))
			.run();

		tx.delete(backupScheduleMirrorsTable)
			.where(inArray(backupScheduleMirrorsTable.scheduleId, orphanScheduleIds))
			.run();

		tx.delete(backupSchedulesTable).where(inArray(backupSchedulesTable.id, orphanScheduleIds)).run();
	});

	return { deletedSchedules: orphanScheduleIds.length };
};
const executeBackup = async (scheduleId: number, manual = false) => {
	const result = await validateBackupExecution(scheduleId, manual);

	if (result.type !== "success") {
		return handleValidationResult(scheduleId, result, manual);
	}

	const { context: ctx } = result;
	cache.del(cacheKeys.backup.progress(scheduleId));

	await scheduleQueries.updateStatus(scheduleId, ctx.organizationId, {
		lastBackupStatus: "in_progress",
		lastBackupError: null,
		...(ctx.schedule.cronExpression ? { nextBackupAt: calculateNextRun(ctx.schedule.cronExpression) } : {}),
	});

	const task = taskStore.create({
		organizationId: ctx.organizationId,
		resourceType: BACKUP_TASK_RESOURCE_TYPE,
		resourceId: String(scheduleId),
		targetAgentId: ctx.volume.agentId,
		input: { kind: "backup", scheduleId, scheduleShortId: ctx.schedule.shortId, manual },
	});

	const abortController = backupExecutor.track(scheduleId);
	emitBackupStarted(ctx, scheduleId);
	const progressBuffer = createTaskProgressBuffer(task.id, {
		onError: (error) => {
			logger.error(`Failed to persist backup task progress for ${task.id}: ${toMessage(error)}`);
		},
	});
	let domainHandlerCompleted = false;

	try {
		const releaseLock = await repoMutex.acquireShared(
			ctx.repository.id,
			`backup:${ctx.volume.name}`,
			abortController.signal,
		);

		try {
			taskStore.markRunning(task.id);

			const executionResult = await backupExecutor.execute({
				jobId: task.id,
				scheduleId,
				schedule: ctx.schedule,
				volume: ctx.volume,
				repository: ctx.repository,
				organizationId: ctx.organizationId,
				signal: abortController.signal,
				onProgress: (progress) => {
					updateBackupProgress(ctx, progress);
					progressBuffer.update({ kind: "backup", progress });
				},
			});

			switch (executionResult.status) {
				case "unavailable": {
					progressBuffer.flush();
					await handleBackupFailure(scheduleId, ctx.organizationId, executionResult.error, manual, ctx);
					domainHandlerCompleted = true;
					taskStore.fail(task.id, toMessage(executionResult.error));
					return;
				}
				case "completed":
					progressBuffer.flush();
					await finalizeSuccessfulBackup(
						ctx,
						executionResult.exitCode,
						executionResult.result,
						executionResult.warningDetails,
					);
					domainHandlerCompleted = true;
					taskStore.complete(task.id, {
						kind: "backup",
						exitCode: executionResult.exitCode,
						result: executionResult.result,
						warningDetails: executionResult.warningDetails,
					});
					return;
				case "failed": {
					progressBuffer.flush();
					await handleBackupFailure(scheduleId, ctx.organizationId, executionResult.error, manual, ctx);
					domainHandlerCompleted = true;
					taskStore.fail(task.id, toMessage(executionResult.error));
					return;
				}
				case "cancelled":
					progressBuffer.flush();
					await handleBackupCancellation(scheduleId, ctx.organizationId, executionResult.message);
					domainHandlerCompleted = true;
					taskStore.cancel(task.id, executionResult.message ?? "Backup was stopped by the user");
					return;
			}
		} finally {
			releaseLock();
		}
	} catch (error) {
		if (abortController.signal.aborted) {
			progressBuffer.flush();
			taskStore.cancel(task.id, "Backup was stopped by the user");
			return;
		}

		if (domainHandlerCompleted) {
			throw error;
		}

		progressBuffer.flush();
		await handleBackupFailure(scheduleId, ctx.organizationId, error, manual, ctx);
		taskStore.fail(task.id, toMessage(error));
	} finally {
		progressBuffer.dispose();
		backupExecutor.untrack(scheduleId, abortController);
		cache.del(cacheKeys.backup.progress(scheduleId));
	}
};

const getSchedulesToExecute = async () => {
	const organizationId = getOrganizationId();
	return scheduleQueries.findExecutable(organizationId);
};

const stopBackup = async (scheduleId: number) => {
	const organizationId = getOrganizationId();
	const schedule = await scheduleQueries.findById(scheduleId, organizationId);

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	const activeTaskResource = {
		organizationId,
		kind: "backup",
		resourceType: BACKUP_TASK_RESOURCE_TYPE,
		resourceId: String(scheduleId),
	} as const;
	const activeTask = taskStore.findActiveByResource(activeTaskResource);
	let shouldMarkActiveTaskStale = false;
	if (activeTask) {
		shouldMarkActiveTaskStale = tryCancelTask(activeTask.id, activeTaskResource);
	}

	try {
		if (!(await backupExecutor.cancel(scheduleId))) {
			if (shouldMarkActiveTaskStale) {
				taskStore.markActiveStale({
					...activeTaskResource,
					error: "No live backup execution was found for this schedule",
				});
			}
			throw new ConflictError("No backup is currently running for this schedule");
		}

		logger.info(`Stopping backup for schedule ${scheduleId}`);
	} finally {
		await handleBackupCancellation(scheduleId, organizationId, undefined, false);
	}
};

const getMirrorSyncStatus = async (scheduleIdOrShortId: number | string, mirrorShortId: ShortId) => {
	const organizationId = getOrganizationId();
	const schedule = await getScheduleByIdOrShortId(scheduleIdOrShortId);

	const mirrorRepo = await db.query.repositoriesTable.findFirst({
		where: {
			AND: [{ shortId: { eq: mirrorShortId } }, { organizationId }],
		},
	});

	if (!mirrorRepo) {
		throw new NotFoundError("Mirror repository not found");
	}

	const mirror = await mirrorQueries.findByScheduleAndRepository(schedule.id, mirrorRepo.id);

	if (!mirror) {
		throw new NotFoundError("Mirror not found for this schedule");
	}

	const [sourceSnapshots, mirrorSnapshots] = await runEffectPromise(
		Effect.all(
			[
				restic.snapshots(schedule.repository.config, { tags: [schedule.shortId], organizationId }),
				restic.snapshots(mirrorRepo.config, { tags: [schedule.shortId], organizationId }),
			],
			{ concurrency: "unbounded" },
		),
	);

	const mirrorSnapshotTimes = new Set(mirrorSnapshots.map((s) => s.time));

	const missingSnapshots = sourceSnapshots
		.filter((s) => !mirrorSnapshotTimes.has(s.time))
		.map((s) => ({
			short_id: s.short_id,
			time: s.time,
			size: s.summary?.total_bytes_processed ?? 0,
		}));

	return {
		sourceCount: sourceSnapshots.length,
		mirrorCount: mirrorSnapshots.length,
		missingSnapshots,
	};
};

const syncMirror = async (scheduleIdOrShortId: number | string, mirrorShortId: ShortId, snapshotIds?: string[]) => {
	const organizationId = getOrganizationId();
	const schedule = await getScheduleByIdOrShortId(scheduleIdOrShortId);

	const mirrorRepo = await db.query.repositoriesTable.findFirst({
		where: {
			AND: [{ shortId: { eq: mirrorShortId } }, { organizationId }],
		},
	});

	if (!mirrorRepo) {
		throw new NotFoundError("Mirror repository not found");
	}

	const mirror = await mirrorQueries.findByScheduleAndRepository(schedule.id, mirrorRepo.id);

	if (!mirror) {
		throw new NotFoundError("Mirror not found for this schedule");
	}

	if (mirror.lastCopyStatus === "in_progress") {
		throw new ConflictError("Mirror is already syncing");
	}

	syncSnapshotsToMirror(schedule.id, mirrorRepo.id, organizationId, snapshotIds).catch((error) => {
		logger.error(`Error syncing all snapshots to mirror ${mirrorRepo.name}: ${toMessage(error)}`);
	});

	return { success: true };
};

export const backupsService = {
	listSchedules,
	createSchedule,
	updateSchedule,
	deleteSchedule,
	getScheduleForVolume,
	getMirrors,
	updateMirrors,
	getMirrorCompatibility,
	reorderSchedules,
	cleanupOrphanedSchedules,
	getBackupProgress,
	validateBackupExecution,
	executeBackup,
	getSchedulesToExecute,
	stopBackup,
	runForget,
	copyToMirrors,
	getMirrorSyncStatus,
	syncMirror,
};
