import { and, eq, inArray, lt } from "drizzle-orm";
import { NotFoundError, BadRequestError, ConflictError } from "http-errors-enhanced";
import { checkMirrorCompatibility, getIncompatibleMirrorError } from "~/server/utils/backend-compatibility";
import { generateShortId } from "~/server/utils/id";
import { getOrganizationId } from "~/server/core/request-context";
import { asShortId, type ShortId } from "~/server/utils/branded";
import { validateCustomResticParams } from "@zerobyte/core/restic/server";
import { db } from "../../db/db";
import { backupScheduleMirrorsTable, backupScheduleNotificationsTable, backupSchedulesTable } from "../../db/schema";
import { calculateNextRun, isValidCron } from "./backup.helpers";
import { mirrorQueries, repositoryQueries, scheduleQueries } from "./backups.queries";
import type { CreateBackupScheduleBody, UpdateBackupScheduleBody, UpdateScheduleMirrorsBody } from "./backups.dto";
import { handleValidationResult, validateBackupExecution } from "./helpers/backup-lifecycle";
import { getScheduleByIdOrShortId } from "./helpers/backup-schedule-lookups";
import { commands } from "./commands";
import { createBackupCommand } from "./commands/backup-command";
import { restic } from "../../core/restic";
import { runEffectPromise } from "../../utils/errors";
import { Effect } from "effect";
import { taskStore } from "../tasks/tasks.store";
import type { ParsedTask } from "~/schemas/tasks";

const BACKUP_TASK_RESOURCE_TYPE = "backup_schedule";
const RESTART_BACKUP_ERROR = "Zerobyte was restarted during the last scheduled backup";

const normalizeRetentionPolicy = (retentionPolicy: CreateBackupScheduleBody["retentionPolicy"]) => {
	if (retentionPolicy !== undefined && Object.keys(retentionPolicy).length === 0) {
		return null;
	}

	return retentionPolicy;
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
				{
					OR: [{ id: Number(data.volumeId) }, { shortId: { eq: asShortId(String(data.volumeId)) } }],
				},
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
				{
					OR: [{ id: data.repositoryId }, { shortId: { eq: asShortId(data.repositoryId) } }],
				},
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
	const retentionPolicy = normalizeRetentionPolicy(data.retentionPolicy);

	const [newSchedule] = await db
		.insert(backupSchedulesTable)
		.values({
			name: data.name,
			volumeId: volume.id,
			repositoryId: repository.id,
			enabled: data.enabled,
			cronExpression: data.cronExpression,
			retentionPolicy: retentionPolicy ?? null,
			excludePatterns: data.excludePatterns ?? [],
			excludeIfPresent: data.excludeIfPresent ?? [],
			includePaths: data.includePaths ?? [],
			includePatterns: data.includePatterns ?? [],
			oneFileSystem: data.oneFileSystem,
			customResticParams: data.customResticParams ?? [],
			compressionMode: data.compressionMode ?? null,
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
				{
					OR: [{ id: data.repositoryId }, { shortId: { eq: asShortId(data.repositoryId) } }],
				},
				{ organizationId },
			],
		},
	});

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const cronExpression = data.cronExpression ?? schedule.cronExpression;
	let nextBackupAt = schedule.nextBackupAt;

	if (data.cronExpression === "") {
		nextBackupAt = null;
	} else if (data.cronExpression) {
		nextBackupAt = calculateNextRun(cronExpression);
	}

	const { retentionPolicy: requestedRetentionPolicy, ...updateData } = data;
	const retentionPolicy = normalizeRetentionPolicy(requestedRetentionPolicy);

	const updateValues = {
		...updateData,
		repositoryId: repository.id,
		backupWebhooks: data.backupWebhooks,
		nextBackupAt,
		updatedAt: Date.now(),
	};

	if (data.backupWebhooks === undefined) {
		updateValues.backupWebhooks = schedule.backupWebhooks;
	}

	if (retentionPolicy !== undefined) {
		Object.assign(updateValues, { retentionPolicy });
	}

	const [updated] = await db
		.update(backupSchedulesTable)
		.set(updateValues)
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
				{
					OR: [{ id: Number(volumeIdOrShortId) }, { shortId: { eq: asShortId(String(volumeIdOrShortId)) } }],
				},
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
	const mirrorRepositoryIds = mirrors.map((mirror) => mirror.repository.shortId);
	const latestTasks = taskStore.findLatestFinishedByResources(
		{
			organizationId: schedule.organizationId,
			kind: "mirrorSync",
			resourceType: "backup_schedule",
			resourceId: schedule.shortId,
		},
		mirrorRepositoryIds,
	);
	const latestTasksByRepository = new Map(latestTasks.map((task) => [task.operationKey, task]));

	return mirrors.map((mirror) => {
		const latestTask = latestTasksByRepository.get(mirror.repository.shortId);
		const lastSyncTask = latestTask
			? {
					id: latestTask.id,
					status: latestTask.status,
					error: latestTask.error,
					finishedAt: latestTask.finishedAt,
				}
			: null;

		return {
			id: mirror.id,
			scheduleId: schedule.shortId,
			repositoryId: mirror.repository.shortId,
			enabled: mirror.enabled,
			lastSyncTask,
			createdAt: mirror.createdAt,
			repository: mirror.repository,
		};
	});
};

const updateMirrors = async (scheduleIdOrShortId: number | string, data: UpdateScheduleMirrorsBody) => {
	const organizationId = getOrganizationId();
	const schedule = await getScheduleByIdOrShortId(scheduleIdOrShortId);

	const normalizedMirrors = await Promise.all(
		data.mirrors.map(async (mirror) => {
			const repo = await db.query.repositoriesTable.findFirst({
				where: {
					AND: [
						{
							OR: [{ id: mirror.repositoryId }, { shortId: { eq: asShortId(mirror.repositoryId) } }],
						},
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

	await db.delete(backupScheduleMirrorsTable).where(eq(backupScheduleMirrorsTable.scheduleId, schedule.id));

	if (normalizedMirrors.length > 0) {
		await db.insert(backupScheduleMirrorsTable).values(
			normalizedMirrors.map((mirror) => ({
				scheduleId: schedule.id,
				repositoryId: mirror.repositoryId,
				enabled: mirror.enabled,
			})),
		);
	}

	return getMirrors(schedule.id);
};

const getMirrorCompatibility = async (scheduleIdOrShortId: number | string) => {
	const organizationId = getOrganizationId();
	const schedule = await getScheduleByIdOrShortId(scheduleIdOrShortId);

	const allRepositories = await db.query.repositoriesTable.findMany({
		where: { organizationId },
	});
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
		if (result.type === "failure" && manual) {
			throw result.error;
		}

		return handleValidationResult(scheduleId, result, manual);
	}

	const { context: ctx } = result;
	return createBackupCommand({ context: ctx, manual }).start();
};

const getSchedulesToExecute = async () => {
	const organizationId = getOrganizationId();
	return scheduleQueries.findExecutable(organizationId);
};

const getInterruptedBackupScheduleIds = (staleTasks: ParsedTask[]) => {
	const backupTaskScheduleIds = new Set<number>();
	const retryableScheduledTaskScheduleIds = new Set<number>();

	for (const task of staleTasks) {
		if (task.kind !== "backup" || task.resourceType !== BACKUP_TASK_RESOURCE_TYPE) {
			continue;
		}

		if (task.input.kind !== "backup") {
			continue;
		}

		const scheduleId = task.input.scheduleId;

		backupTaskScheduleIds.add(scheduleId);
		if (!task.input.manual && !task.cancellationRequested) {
			retryableScheduledTaskScheduleIds.add(scheduleId);
		}
	}

	return { backupTaskScheduleIds, retryableScheduledTaskScheduleIds };
};

const recoverInterruptedBackups = async (staleTasks: ParsedTask[], bootstrapStartedAt?: number) => {
	const { backupTaskScheduleIds, retryableScheduledTaskScheduleIds } = getInterruptedBackupScheduleIds(staleTasks);
	const now = Date.now();
	const recoveryConditions = [eq(backupSchedulesTable.lastBackupStatus, "in_progress")];
	if (bootstrapStartedAt !== undefined) {
		recoveryConditions.push(lt(backupSchedulesTable.updatedAt, bootstrapStartedAt));
	}

	db.transaction((tx) => {
		const recoveredSchedules = tx
			.update(backupSchedulesTable)
			.set({
				lastBackupStatus: "warning",
				lastBackupError: RESTART_BACKUP_ERROR,
				updatedAt: now,
			})
			.where(and(...recoveryConditions))
			.returning()
			.all();

		const recoveredScheduleIds = new Set<number>();
		const retryScheduleIds = new Set<number>();

		for (const schedule of recoveredSchedules) {
			recoveredScheduleIds.add(schedule.id);

			if (schedule.enabled && schedule.cronExpression && !backupTaskScheduleIds.has(schedule.id)) {
				retryScheduleIds.add(schedule.id);
			}
		}

		for (const scheduleId of retryableScheduledTaskScheduleIds) {
			if (recoveredScheduleIds.has(scheduleId)) {
				retryScheduleIds.add(scheduleId);
			}
		}

		const retryScheduleIdList = [...retryScheduleIds];

		if (retryScheduleIdList.length > 0) {
			tx.update(backupSchedulesTable)
				.set({
					nextBackupAt: null,
					updatedAt: now,
				})
				.where(
					and(
						inArray(backupSchedulesTable.id, retryScheduleIdList),
						eq(backupSchedulesTable.lastBackupStatus, "warning"),
					),
				)
				.run();
		}
	});
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
				restic.snapshots(schedule.repository.config, {
					tags: [schedule.shortId],
					organizationId,
				}),
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

const getMirrorSyncContext = async (scheduleIdOrShortId: number | string, mirrorShortId: ShortId) => {
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

	return { organizationId, schedule, mirrorRepository: mirrorRepo };
};

const startMirrorSync = async (
	scheduleIdOrShortId: number | string,
	mirrorShortId: ShortId,
	snapshotIds?: string[],
) => {
	const { organizationId, schedule, mirrorRepository } = await getMirrorSyncContext(
		scheduleIdOrShortId,
		mirrorShortId,
	);

	const plan = {
		organizationId,
		scheduleId: schedule.id,
		scheduleShortId: schedule.shortId,
		targetDisplayName: schedule.name,
		sourceRepository: schedule.repository,
		mirrorRepository,
		retentionPolicy: schedule.retentionPolicy,
		customResticParams: schedule.customResticParams ?? [],
		trigger: "manual" as const,
		snapshotIds,
	};

	return commands.createMirrorSync(plan).start();
};

const runForget = async (scheduleId: number, repositoryId?: string) => {
	const organizationId = getOrganizationId();
	const schedule = await scheduleQueries.findById(scheduleId, organizationId);
	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	const retentionPolicy = schedule.retentionPolicy;
	if (!retentionPolicy) {
		throw new BadRequestError("No retention policy configured for this schedule");
	}

	const targetRepositoryId = repositoryId ?? schedule.repositoryId;
	const repository = await repositoryQueries.findById(targetRepositoryId, organizationId);
	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const plan = {
		organizationId,
		scheduleId: schedule.id,
		scheduleShortId: schedule.shortId,
		targetDisplayName: schedule.name,
		repository,
		retentionPolicy,
		trigger: "manual" as const,
	};
	return commands.createForget(plan).start();
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
	validateBackupExecution,
	executeBackup,
	getSchedulesToExecute,
	recoverInterruptedBackups,
	runForget,
	getMirrorSyncStatus,
	startMirrorSync,
};
