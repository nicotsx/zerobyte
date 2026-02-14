import { and, eq } from "drizzle-orm";
import cron from "node-cron";
import { NotFoundError, BadRequestError, ConflictError } from "http-errors-enhanced";
import { db } from "../../db/db";
import { backupSchedulesTable, backupScheduleMirrorsTable } from "../../db/schema";
import type { CreateBackupScheduleBody, UpdateBackupScheduleBody, UpdateScheduleMirrorsBody } from "./backups.dto";

import { checkMirrorCompatibility, getIncompatibleMirrorError } from "~/server/utils/backend-compatibility";
import { generateShortId } from "~/server/utils/id";
import { getOrganizationId } from "~/server/core/request-context";
import { calculateNextRun } from "./backup.helpers";

const listSchedules = async () => {
	const organizationId = getOrganizationId();
	const schedules = await db.query.backupSchedulesTable.findMany({
		where: { organizationId },
		with: { volume: true, repository: true },
		orderBy: { sortOrder: "asc", id: "asc" },
	});
	return schedules;
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

	return schedule;
};

const getScheduleByShortId = async (shortId: string) => {
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: { AND: [{ shortId }, { organizationId }] },
		with: { volume: true, repository: true },
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
		where: {
			AND: [{ name: data.name }, { organizationId }],
		},
	});

	if (existingName) {
		throw new ConflictError("A backup schedule with this name already exists");
	}

	const volume = await db.query.volumesTable.findFirst({
		where: {
			AND: [{ id: data.volumeId }, { organizationId }],
		},
	});

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	const repository = await db.query.repositoriesTable.findFirst({
		where: {
			AND: [{ id: data.repositoryId }, { organizationId }],
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
		where: {
			AND: [{ id: scheduleId }, { organizationId }],
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
				AND: [{ name: data.name }, { NOT: { id: scheduleId } }, { organizationId }],
			},
		});

		if (existingName) {
			throw new ConflictError("A backup schedule with this name already exists");
		}
	}

	const repository = await db.query.repositoriesTable.findFirst({
		where: {
			AND: [{ id: data.repositoryId }, { organizationId }],
		},
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
		where: {
			AND: [{ id: scheduleId }, { organizationId }],
		},
	});

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	await db
		.delete(backupSchedulesTable)
		.where(and(eq(backupSchedulesTable.id, scheduleId), eq(backupSchedulesTable.organizationId, organizationId)));
};

const getScheduleForVolume = async (volumeId: number) => {
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: { AND: [{ volumeId }, { organizationId }] },
		with: { volume: true, repository: true },
	});

	return schedule ?? null;
};

const getMirrors = async (scheduleId: number) => {
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: {
			AND: [{ id: scheduleId }, { organizationId }],
		},
	});

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	const mirrors = await db.query.backupScheduleMirrorsTable.findMany({
		where: {
			scheduleId,
		},
		with: { repository: true },
	});

	return mirrors;
};

const updateMirrors = async (scheduleId: number, data: UpdateScheduleMirrorsBody) => {
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: { AND: [{ id: scheduleId }, { organizationId }] },
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
			where: { AND: [{ id: mirror.repositoryId }, { organizationId }] },
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
		where: { scheduleId },
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

const getMirrorCompatibility = async (scheduleId: number) => {
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: { AND: [{ id: scheduleId }, { organizationId }] },
		with: { repository: true },
	});

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	const allRepositories = await db.query.repositoriesTable.findMany({ where: { organizationId } });
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
		where: { organizationId },
		columns: { id: true },
	});
	const existingIds = new Set(existingSchedules.map((s) => s.id));

	for (const id of scheduleIds) {
		if (!existingIds.has(id)) {
			throw new NotFoundError(`Backup schedule with ID ${id} not found`);
		}
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

export const backupsService = {
	listSchedules,
	getScheduleById,
	createSchedule,
	updateSchedule,
	deleteSchedule,
	getScheduleForVolume,
	getMirrors,
	updateMirrors,
	getMirrorCompatibility,
	reorderSchedules,
	getScheduleByShortId,
};
