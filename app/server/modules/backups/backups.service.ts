import { and, eq, inArray } from "drizzle-orm";
import cron from "node-cron";
import { NotFoundError, BadRequestError, ConflictError } from "http-errors-enhanced";
import { db } from "../../db/db";
import { backupScheduleMirrorsTable, backupScheduleNotificationsTable, backupSchedulesTable } from "../../db/schema";
import type { CreateBackupScheduleBody, UpdateBackupScheduleBody, UpdateScheduleMirrorsBody } from "./backups.dto";

import { checkMirrorCompatibility, getIncompatibleMirrorError } from "~/server/utils/backend-compatibility";
import { generateShortId } from "~/server/utils/id";
import { getOrganizationId } from "~/server/core/request-context";
import { calculateNextRun } from "./backup.helpers";
import { asShortId, type ShortId } from "~/server/utils/branded";

const listSchedules = async () => {
	const organizationId = getOrganizationId();
	const schedules = await db.query.backupSchedulesTable.findMany({
		where: { organizationId },
		with: { volume: true, repository: true },
		orderBy: { sortOrder: "asc", id: "asc" },
	});
	return schedules.filter((schedule) => schedule.volume && schedule.repository);
};

const getScheduleById = async (scheduleId: number) => {
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: { AND: [{ id: scheduleId }, { organizationId }] },
		with: { volume: true, repository: true },
	});

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	if (!schedule.volume || !schedule.repository) {
		throw new NotFoundError("Backup schedule not found");
	}

	return schedule;
};

const getScheduleByShortId = async (shortId: ShortId) => {
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: { AND: [{ shortId: { eq: shortId } }, { organizationId }] },
		with: { volume: true, repository: true },
	});

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	if (!schedule.volume || !schedule.repository) {
		throw new NotFoundError("Backup schedule not found");
	}

	return schedule;
};

const getScheduleByIdOrShortId = async (idOrShortId: string | number) => {
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: {
			AND: [
				{ OR: [{ id: Number(idOrShortId) }, { shortId: { eq: asShortId(String(idOrShortId)) } }] },
				{ organizationId },
			],
		},
		with: { volume: true, repository: true },
	});

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	if (!schedule.volume || !schedule.repository) {
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
			AND: [{ OR: [{ id: data.repositoryId }, { shortId: { eq: asShortId(data.repositoryId) } }] }, { organizationId }],
		},
	});

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const nextBackupAt = calculateNextRun(data.cronExpression);

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

const updateSchedule = async (scheduleIdOrShortId: number | string, data: UpdateBackupScheduleBody) => {
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: {
			AND: [
				{ OR: [{ id: Number(scheduleIdOrShortId) }, { shortId: { eq: asShortId(String(scheduleIdOrShortId)) } }] },
				{ organizationId },
			],
		},
	});

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	if (data.cronExpression && !cron.validate(data.cronExpression)) {
		throw new BadRequestError("Invalid cron expression");
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
			AND: [{ OR: [{ id: data.repositoryId }, { shortId: { eq: asShortId(data.repositoryId) } }] }, { organizationId }],
		},
	});

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const cronExpression = data.cronExpression ?? schedule.cronExpression;
	const nextBackupAt = data.cronExpression ? calculateNextRun(cronExpression) : schedule.nextBackupAt;

	const [updated] = await db
		.update(backupSchedulesTable)
		.set({ ...data, repositoryId: repository.id, nextBackupAt, updatedAt: Date.now() })
		.where(and(eq(backupSchedulesTable.id, schedule.id), eq(backupSchedulesTable.organizationId, organizationId)))
		.returning();

	if (!updated) {
		throw new Error("Failed to update backup schedule");
	}

	return updated;
};

const deleteSchedule = async (scheduleIdOrShortId: number | string) => {
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: {
			AND: [
				{ OR: [{ id: Number(scheduleIdOrShortId) }, { shortId: { eq: asShortId(String(scheduleIdOrShortId)) } }] },
				{ organizationId },
			],
		},
	});

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

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
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: {
			AND: [
				{ OR: [{ id: Number(scheduleIdOrShortId) }, { shortId: { eq: asShortId(String(scheduleIdOrShortId)) } }] },
				{ organizationId },
			],
		},
	});

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

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
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: {
			AND: [
				{ OR: [{ id: Number(scheduleIdOrShortId) }, { shortId: { eq: asShortId(String(scheduleIdOrShortId)) } }] },
				{ organizationId },
			],
		},
		with: { repository: true },
	});

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

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
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: {
			AND: [
				{ OR: [{ id: Number(scheduleIdOrShortId) }, { shortId: { eq: asShortId(String(scheduleIdOrShortId)) } }] },
				{ organizationId },
			],
		},
		with: { repository: true },
	});

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

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
				.where(and(eq(backupSchedulesTable.id, scheduleId), eq(backupSchedulesTable.organizationId, organizationId)))
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

export const backupsService = {
	listSchedules,
	getScheduleById,
	getScheduleByIdOrShortId,
	createSchedule,
	updateSchedule,
	deleteSchedule,
	getScheduleForVolume,
	getMirrors,
	updateMirrors,
	getMirrorCompatibility,
	reorderSchedules,
	getScheduleByShortId,
	cleanupOrphanedSchedules,
};
