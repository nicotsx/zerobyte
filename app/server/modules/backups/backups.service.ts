import { and, asc, eq, isNull, ne, or } from "drizzle-orm";
import cron from "node-cron";
import { CronExpressionParser } from "cron-parser";
import { NotFoundError, BadRequestError, ConflictError } from "http-errors-enhanced";
import { db } from "../../db/db";
import { backupSchedulesTable, backupScheduleMirrorsTable, repositoriesTable, volumesTable } from "../../db/schema";
import { restic } from "../../utils/restic";
import { logger } from "../../utils/logger";
import { cache } from "../../utils/cache";
import { getVolumePath } from "../volumes/helpers";
import type { CreateBackupScheduleBody, UpdateBackupScheduleBody, UpdateScheduleMirrorsBody } from "./backups.dto";
import { toMessage } from "../../utils/errors";
import { serverEvents } from "../../core/events";
import { notificationsService } from "../notifications/notifications.service";
import { repoMutex } from "../../core/repository-mutex";
import { checkMirrorCompatibility, getIncompatibleMirrorError } from "~/server/utils/backend-compatibility";
import path from "node:path";
import { generateShortId } from "~/server/utils/id";
import { getOrganizationId } from "~/server/core/request-context";

const runningBackups = new Map<number, AbortController>();

const calculateNextRun = (cronExpression: string): number => {
	try {
		const interval = CronExpressionParser.parse(cronExpression, {
			currentDate: new Date(),
			tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
		});

		return interval.next().getTime();
	} catch (error) {
		logger.error(`Failed to parse cron expression "${cronExpression}": ${toMessage(error)}`);
		const fallback = new Date();
		fallback.setMinutes(fallback.getMinutes() + 1);
		return fallback.getTime();
	}
};

const processPattern = (pattern: string, volumePath: string): string => {
	let isNegated = false;
	let p = pattern;

	if (p.startsWith("!")) {
		isNegated = true;
		p = p.slice(1);
	}

	if (p.startsWith(volumePath)) {
		return pattern;
	}

	if (p.startsWith("/")) {
		const processed = path.join(volumePath, p.slice(1));
		return isNegated ? `!${processed}` : processed;
	}

	return pattern;
};

const listSchedules = async () => {
	const organizationId = getOrganizationId();
	const schedules = await db.query.backupSchedulesTable.findMany({
		where: eq(backupSchedulesTable.organizationId, organizationId),
		with: {
			volume: true,
			repository: true,
		},
		orderBy: [asc(backupSchedulesTable.sortOrder), asc(backupSchedulesTable.id)],
	});
	return schedules;
};

const getSchedule = async (scheduleId: number) => {
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: and(eq(backupSchedulesTable.id, scheduleId), eq(backupSchedulesTable.organizationId, organizationId)),
		with: {
			volume: true,
			repository: true,
		},
	});

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	return schedule;
};

const createSchedule = async (data: CreateBackupScheduleBody) => {
	const organizationId = getOrganizationId();
	if (!cron.validate(data.cronExpression)) {
		throw new BadRequestError("Invalid cron expression");
	}

	const existingName = await db.query.backupSchedulesTable.findFirst({
		where: and(eq(backupSchedulesTable.name, data.name), eq(backupSchedulesTable.organizationId, organizationId)),
	});

	if (existingName) {
		throw new ConflictError("A backup schedule with this name already exists");
	}

	const volume = await db.query.volumesTable.findFirst({
		where: and(eq(volumesTable.id, data.volumeId), eq(volumesTable.organizationId, organizationId)),
	});

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	const repository = await db.query.repositoriesTable.findFirst({
		where: and(eq(repositoriesTable.id, data.repositoryId), eq(repositoriesTable.organizationId, organizationId)),
	});

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const nextBackupAt = calculateNextRun(data.cronExpression);

	const [newSchedule] = await db
		.insert(backupSchedulesTable)
		.values({
			name: data.name,
			volumeId: data.volumeId,
			repositoryId: data.repositoryId,
			enabled: data.enabled,
			cronExpression: data.cronExpression,
			retentionPolicy: data.retentionPolicy ?? null,
			excludePatterns: data.excludePatterns ?? [],
			excludeIfPresent: data.excludeIfPresent ?? [],
			includePatterns: data.includePatterns ?? [],
			oneFileSystem: data.oneFileSystem,
			nextBackupAt: nextBackupAt,
			shortId: generateShortId(),
			organizationId,
		})
		.returning();

	if (!newSchedule) {
		throw new Error("Failed to create backup schedule");
	}

	return newSchedule;
};

const updateSchedule = async (scheduleId: number, data: UpdateBackupScheduleBody) => {
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: and(eq(backupSchedulesTable.id, scheduleId), eq(backupSchedulesTable.organizationId, organizationId)),
	});

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	if (data.cronExpression && !cron.validate(data.cronExpression)) {
		throw new BadRequestError("Invalid cron expression");
	}

	if (data.name) {
		const existingName = await db.query.backupSchedulesTable.findFirst({
			where: and(eq(backupSchedulesTable.name, data.name), ne(backupSchedulesTable.id, scheduleId), eq(backupSchedulesTable.organizationId, organizationId)),
		});

		if (existingName) {
			throw new ConflictError("A backup schedule with this name already exists");
		}
	}

	const repository = await db.query.repositoriesTable.findFirst({
		where: and(eq(repositoriesTable.id, data.repositoryId), eq(repositoriesTable.organizationId, organizationId)),
	});

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const cronExpression = data.cronExpression ?? schedule.cronExpression;
	const nextBackupAt = data.cronExpression ? calculateNextRun(cronExpression) : schedule.nextBackupAt;

	const [updated] = await db
		.update(backupSchedulesTable)
		.set({ ...data, nextBackupAt, updatedAt: Date.now() })
		.where(and(eq(backupSchedulesTable.id, scheduleId), eq(backupSchedulesTable.organizationId, organizationId)))
		.returning();

	if (!updated) {
		throw new Error("Failed to update backup schedule");
	}

	return updated;
};

const deleteSchedule = async (scheduleId: number) => {
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: and(eq(backupSchedulesTable.id, scheduleId), eq(backupSchedulesTable.organizationId, organizationId)),
	});

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	await db
		.delete(backupSchedulesTable)
		.where(and(eq(backupSchedulesTable.id, scheduleId), eq(backupSchedulesTable.organizationId, organizationId)));
};

const executeBackup = async (scheduleId: number, manual = false) => {
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: and(eq(backupSchedulesTable.id, scheduleId), eq(backupSchedulesTable.organizationId, organizationId)),
	});

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	if (!schedule.enabled && !manual) {
		logger.info(`Backup schedule ${scheduleId} is disabled. Skipping execution.`);
		return;
	}

	if (schedule.lastBackupStatus === "in_progress") {
		logger.info(`Backup schedule ${scheduleId} is already in progress. Skipping execution.`);
		return;
	}

	const volume = await db.query.volumesTable.findFirst({
		where: and(eq(volumesTable.id, schedule.volumeId), eq(volumesTable.organizationId, organizationId)),
	});

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	const repository = await db.query.repositoriesTable.findFirst({
		where: and(eq(repositoriesTable.id, schedule.repositoryId), eq(repositoriesTable.organizationId, organizationId)),
	});

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	if (volume.status !== "mounted") {
		throw new BadRequestError("Volume is not mounted");
	}

	logger.info(`Starting backup ${schedule.name} for volume ${volume.name} to repository ${repository.name}`);

	serverEvents.emit("backup:started", {
		scheduleId,
		volumeName: volume.name,
		repositoryName: repository.name,
	});

	notificationsService
		.sendBackupNotification(scheduleId, "start", {
			volumeName: volume.name,
			repositoryName: repository.name,
			scheduleName: schedule.name,
		})
		.catch((error) => {
			logger.error(`Failed to send backup start notification: ${toMessage(error)}`);
		});

	const nextBackupAt = calculateNextRun(schedule.cronExpression);

	await db
		.update(backupSchedulesTable)
		.set({
			lastBackupStatus: "in_progress",
			updatedAt: Date.now(),
			lastBackupError: null,
			nextBackupAt,
		})
		.where(and(eq(backupSchedulesTable.id, scheduleId), eq(backupSchedulesTable.organizationId, organizationId)));

	const abortController = new AbortController();
	runningBackups.set(scheduleId, abortController);

	try {
		const volumePath = getVolumePath(volume);

		const backupOptions: {
			exclude?: string[];
			excludeIfPresent?: string[];
			include?: string[];
			tags?: string[];
			oneFileSystem?: boolean;
			signal?: AbortSignal;
		} = {
			tags: [schedule.shortId],
			oneFileSystem: schedule.oneFileSystem,
			signal: abortController.signal,
		};

		if (schedule.excludePatterns && schedule.excludePatterns.length > 0) {
			backupOptions.exclude = schedule.excludePatterns.map((p) => processPattern(p, volumePath));
		}

		if (schedule.excludeIfPresent && schedule.excludeIfPresent.length > 0) {
			backupOptions.excludeIfPresent = schedule.excludeIfPresent;
		}

		if (schedule.includePatterns && schedule.includePatterns.length > 0) {
			backupOptions.include = schedule.includePatterns.map((p) => processPattern(p, volumePath));
		}

		const releaseBackupLock = await repoMutex.acquireShared(repository.id, `backup:${volume.name}`);
		let exitCode: number;
		try {
			const result = await restic.backup(repository.config, volumePath, {
				...backupOptions,
				compressionMode: repository.compressionMode ?? "auto",
				organizationId,
				onProgress: (progress) => {
					serverEvents.emit("backup:progress", {
						scheduleId,
						volumeName: volume.name,
						repositoryName: repository.name,
						...progress,
					});
				},
			});
			exitCode = result.exitCode;
		} finally {
			releaseBackupLock();
		}

		if (schedule.retentionPolicy) {
			void runForget(schedule.id).catch((error) => {
				logger.error(`Failed to run retention policy for schedule ${scheduleId}: ${toMessage(error)}`);
			});
		}

		void copyToMirrors(scheduleId, repository, schedule.retentionPolicy).catch((error) => {
			logger.error(`Background mirror copy failed for schedule ${scheduleId}: ${toMessage(error)}`);
		});

		const finalStatus = exitCode === 0 ? "success" : "warning";

		cache.delByPrefix(`snapshots:${repository.id}:`);

		const nextBackupAt = calculateNextRun(schedule.cronExpression);
		await db
			.update(backupSchedulesTable)
			.set({
				lastBackupAt: Date.now(),
				lastBackupStatus: finalStatus,
				lastBackupError: null,
				nextBackupAt: nextBackupAt,
				updatedAt: Date.now(),
			})
			.where(and(eq(backupSchedulesTable.id, scheduleId), eq(backupSchedulesTable.organizationId, organizationId)));

		if (finalStatus === "warning") {
			logger.warn(
				`Backup ${schedule.name} completed with warnings for volume ${volume.name} to repository ${repository.name}`,
			);
		} else {
			logger.info(
				`Backup ${schedule.name} completed successfully for volume ${volume.name} to repository ${repository.name}`,
			);
		}

		serverEvents.emit("backup:completed", {
			scheduleId,
			volumeName: volume.name,
			repositoryName: repository.name,
			status: finalStatus,
		});

		notificationsService
			.sendBackupNotification(scheduleId, finalStatus === "success" ? "success" : "warning", {
				volumeName: volume.name,
				repositoryName: repository.name,
				scheduleName: schedule.name,
			})
			.catch((error) => {
				logger.error(`Failed to send backup success notification: ${toMessage(error)}`);
			});
	} catch (error) {
		logger.error(
			`Backup ${schedule.name} failed for volume ${volume.name} to repository ${repository.name}: ${toMessage(error)}`,
		);

		await db
			.update(backupSchedulesTable)
			.set({
				lastBackupAt: Date.now(),
				lastBackupStatus: "error",
				lastBackupError: toMessage(error),
				updatedAt: Date.now(),
			})
			.where(and(eq(backupSchedulesTable.id, scheduleId), eq(backupSchedulesTable.organizationId, organizationId)));

		serverEvents.emit("backup:completed", {
			scheduleId,
			volumeName: volume.name,
			repositoryName: repository.name,
			status: "error",
		});

		notificationsService
			.sendBackupNotification(scheduleId, "failure", {
				volumeName: volume.name,
				repositoryName: repository.name,
				scheduleName: schedule.name,
				error: toMessage(error),
			})
			.catch((notifError) => {
				logger.error(`Failed to send backup failure notification: ${toMessage(notifError)}`);
			});
	} finally {
		runningBackups.delete(scheduleId);
	}
};

const getSchedulesToExecute = async () => {
	const organizationId = getOrganizationId();
	const now = Date.now();
	const schedules = await db.query.backupSchedulesTable.findMany({
		where: and(
			eq(backupSchedulesTable.enabled, true),
			or(ne(backupSchedulesTable.lastBackupStatus, "in_progress"), isNull(backupSchedulesTable.lastBackupStatus)),
			eq(backupSchedulesTable.organizationId, organizationId),
		),
	});

	const schedulesToRun: number[] = [];

	for (const schedule of schedules) {
		if (!schedule.nextBackupAt || schedule.nextBackupAt <= now) {
			schedulesToRun.push(schedule.id);
		}
	}

	return schedulesToRun;
};

const getScheduleForVolume = async (volumeId: number) => {
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: and(eq(backupSchedulesTable.volumeId, volumeId), eq(backupSchedulesTable.organizationId, organizationId)),
		with: { volume: true, repository: true },
	});

	return schedule ?? null;
};

const stopBackup = async (scheduleId: number) => {
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: and(eq(backupSchedulesTable.id, scheduleId), eq(backupSchedulesTable.organizationId, organizationId)),
	});

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	try {
		const abortController = runningBackups.get(scheduleId);
		if (!abortController) {
			throw new ConflictError("No backup is currently running for this schedule");
		}

		logger.info(`Stopping backup for schedule ${scheduleId}`);

		abortController.abort();
	} finally {
		await db
			.update(backupSchedulesTable)
			.set({
				lastBackupStatus: "warning",
				lastBackupError: "Backup was stopped by user",
				updatedAt: Date.now(),
			})
			.where(and(eq(backupSchedulesTable.id, scheduleId), eq(backupSchedulesTable.organizationId, organizationId)));
	}
};

const runForget = async (scheduleId: number, repositoryId?: string) => {
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: and(eq(backupSchedulesTable.id, scheduleId), eq(backupSchedulesTable.organizationId, organizationId)),
	});

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	if (!schedule.retentionPolicy) {
		throw new BadRequestError("No retention policy configured for this schedule");
	}

	const repository = await db.query.repositoriesTable.findFirst({
		where: and(eq(repositoriesTable.id, repositoryId ?? schedule.repositoryId), eq(repositoriesTable.organizationId, organizationId)),
	});

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	logger.info(`running retention policy (forget) for schedule ${scheduleId}`);
	const releaseLock = await repoMutex.acquireExclusive(repository.id, `forget:${scheduleId}`);
	try {
		await restic.forget(repository.config, schedule.retentionPolicy, { tag: schedule.shortId, organizationId });
		cache.delByPrefix(`snapshots:${repository.id}:`);
	} finally {
		releaseLock();
	}

	logger.info(`Retention policy applied successfully for schedule ${scheduleId}`);
};

const getMirrors = async (scheduleId: number) => {
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: and(eq(backupSchedulesTable.id, scheduleId), eq(backupSchedulesTable.organizationId, organizationId)),
	});

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	const mirrors = await db.query.backupScheduleMirrorsTable.findMany({
		where: eq(backupScheduleMirrorsTable.scheduleId, scheduleId),
		with: { repository: true },
	});

	return mirrors;
};

const updateMirrors = async (scheduleId: number, data: UpdateScheduleMirrorsBody) => {
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: and(eq(backupSchedulesTable.id, scheduleId), eq(backupSchedulesTable.organizationId, organizationId)),
		with: { repository: true },
	});

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	for (const mirror of data.mirrors) {
		if (mirror.repositoryId === schedule.repositoryId) {
			throw new BadRequestError("Cannot add the primary repository as a mirror");
		}

		const repo = await db.query.repositoriesTable.findFirst({
			where: and(eq(repositoriesTable.id, mirror.repositoryId), eq(repositoriesTable.organizationId, organizationId)),
		});

		if (!repo) {
			throw new NotFoundError(`Repository ${mirror.repositoryId} not found`);
		}

		const compatibility = await checkMirrorCompatibility(schedule.repository.config, repo.config, repo.id);

		if (!compatibility.compatible) {
			throw new BadRequestError(
				getIncompatibleMirrorError(repo.name, schedule.repository.config.backend, repo.config.backend),
			);
		}
	}

	const existingMirrors = await db.query.backupScheduleMirrorsTable.findMany({
		where: eq(backupScheduleMirrorsTable.scheduleId, scheduleId),
	});

	const existingMirrorsMap = new Map(
		existingMirrors.map((m) => [
			m.repositoryId,
			{ lastCopyAt: m.lastCopyAt, lastCopyStatus: m.lastCopyStatus, lastCopyError: m.lastCopyError },
		]),
	);

	await db.delete(backupScheduleMirrorsTable).where(eq(backupScheduleMirrorsTable.scheduleId, scheduleId));

	if (data.mirrors.length > 0) {
		await db.insert(backupScheduleMirrorsTable).values(
			data.mirrors.map((mirror) => {
				const existing = existingMirrorsMap.get(mirror.repositoryId);
				return {
					scheduleId,
					repositoryId: mirror.repositoryId,
					enabled: mirror.enabled,
					lastCopyAt: existing?.lastCopyAt ?? null,
					lastCopyStatus: existing?.lastCopyStatus ?? null,
					lastCopyError: existing?.lastCopyError ?? null,
				};
			}),
		);
	}

	return getMirrors(scheduleId);
};

const copyToMirrors = async (
	scheduleId: number,
	sourceRepository: { id: string; config: (typeof repositoriesTable.$inferSelect)["config"] },
	retentionPolicy: (typeof backupSchedulesTable.$inferSelect)["retentionPolicy"],
) => {
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: and(eq(backupSchedulesTable.id, scheduleId), eq(backupSchedulesTable.organizationId, organizationId)),
	});

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	const mirrors = await db.query.backupScheduleMirrorsTable.findMany({
		where: eq(backupScheduleMirrorsTable.scheduleId, scheduleId),
		with: { repository: true },
	});

	const enabledMirrors = mirrors.filter((m) => m.enabled);

	if (enabledMirrors.length === 0) {
		return;
	}

	logger.info(
		`[Background] Copying snapshots to ${enabledMirrors.length} mirror repositories for schedule ${scheduleId}`,
	);

	for (const mirror of enabledMirrors) {
		try {
			logger.info(`[Background] Copying to mirror repository: ${mirror.repository.name}`);

			serverEvents.emit("mirror:started", {
				scheduleId,
				repositoryId: mirror.repositoryId,
				repositoryName: mirror.repository.name,
			});

			const releaseSource = await repoMutex.acquireShared(sourceRepository.id, `mirror_source:${scheduleId}`);
			const releaseMirror = await repoMutex.acquireShared(mirror.repository.id, `mirror:${scheduleId}`);

			try {
				await restic.copy(sourceRepository.config, mirror.repository.config, { tag: schedule.shortId, organizationId });
				cache.delByPrefix(`snapshots:${mirror.repository.id}:`);
			} finally {
				releaseSource();
				releaseMirror();
			}

			if (retentionPolicy) {
				void runForget(scheduleId, mirror.repository.id).catch((error) => {
					logger.error(
						`Failed to run retention policy for mirror repository ${mirror.repository.name}: ${toMessage(error)}`,
					);
				});
			}

			await db
				.update(backupScheduleMirrorsTable)
				.set({ lastCopyAt: Date.now(), lastCopyStatus: "success", lastCopyError: null })
				.where(eq(backupScheduleMirrorsTable.id, mirror.id));

			logger.info(`[Background] Successfully copied to mirror repository: ${mirror.repository.name}`);

			serverEvents.emit("mirror:completed", {
				scheduleId,
				repositoryId: mirror.repositoryId,
				repositoryName: mirror.repository.name,
				status: "success",
			});
		} catch (error) {
			const errorMessage = toMessage(error);
			logger.error(`[Background] Failed to copy to mirror repository ${mirror.repository.name}: ${errorMessage}`);

			await db
				.update(backupScheduleMirrorsTable)
				.set({ lastCopyAt: Date.now(), lastCopyStatus: "error", lastCopyError: errorMessage })
				.where(eq(backupScheduleMirrorsTable.id, mirror.id));

			serverEvents.emit("mirror:completed", {
				scheduleId,
				repositoryId: mirror.repositoryId,
				repositoryName: mirror.repository.name,
				status: "error",
				error: errorMessage,
			});
		}
	}
};

const getMirrorCompatibility = async (scheduleId: number) => {
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: and(eq(backupSchedulesTable.id, scheduleId), eq(backupSchedulesTable.organizationId, organizationId)),
		with: { repository: true },
	});

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	const allRepositories = await db.query.repositoriesTable.findMany({
		where: eq(repositoriesTable.organizationId, organizationId),
	});
	const repos = allRepositories.filter((repo) => repo.id !== schedule.repositoryId);

	const compatibility = await Promise.all(
		repos.map((repo) => checkMirrorCompatibility(schedule.repository.config, repo.config, repo.id)),
	);

	return compatibility;
};

const reorderSchedules = async (scheduleIds: number[]) => {
	const organizationId = getOrganizationId();
	const uniqueIds = new Set(scheduleIds);
	if (uniqueIds.size !== scheduleIds.length) {
		throw new BadRequestError("Duplicate schedule IDs in reorder request");
	}

	const existingSchedules = await db.query.backupSchedulesTable.findMany({
		where: eq(backupSchedulesTable.organizationId, organizationId),
		columns: { id: true },
	});
	const existingIds = new Set(existingSchedules.map((s) => s.id));

	for (const id of scheduleIds) {
		if (!existingIds.has(id)) {
			throw new NotFoundError(`Backup schedule with ID ${id} not found`);
		}
	}

	await db.transaction(async (tx) => {
		const now = Date.now();
		await Promise.all(
			scheduleIds.map((scheduleId, index) =>
				tx
					.update(backupSchedulesTable)
					.set({ sortOrder: index, updatedAt: now })
					.where(and(eq(backupSchedulesTable.id, scheduleId), eq(backupSchedulesTable.organizationId, organizationId))),
			),
		);
	});
};

export const backupsService = {
	listSchedules,
	getSchedule,
	createSchedule,
	updateSchedule,
	deleteSchedule,
	executeBackup,
	getSchedulesToExecute,
	getScheduleForVolume,
	stopBackup,
	runForget,
	getMirrors,
	updateMirrors,
	getMirrorCompatibility,
	reorderSchedules,
};
