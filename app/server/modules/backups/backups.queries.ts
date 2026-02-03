import { and, eq } from "drizzle-orm";
import { db } from "../../db/db";
import { backupSchedulesTable, backupScheduleMirrorsTable } from "../../db/schema";

export type BackupStatusType = "in_progress" | "success" | "warning" | "error";
export type MirrorStatusType = "success" | "error";

export const scheduleQueries = {
	findById: async (scheduleId: number, organizationId: string) => {
		return db.query.backupSchedulesTable.findFirst({
			where: { AND: [{ id: scheduleId }, { organizationId }] },
			with: { volume: true, repository: true },
		});
	},

	findExecutable: async (organizationId: string) => {
		const now = Date.now();
		const schedules = await db.query.backupSchedulesTable.findMany({
			where: {
				AND: [
					{ enabled: true },
					{ OR: [{ lastBackupStatus: { NOT: "in_progress" } }, { lastBackupStatus: { isNull: true } }] },
					{ organizationId },
				],
			},
		});

		return schedules.filter((s) => !s.nextBackupAt || s.nextBackupAt <= now).map((s) => s.id);
	},

	updateStatus: async (
		scheduleId: number,
		organizationId: string,
		status: {
			lastBackupStatus?: BackupStatusType;
			lastBackupAt?: number;
			lastBackupError?: string | null;
			nextBackupAt?: number;
		},
	) => {
		return db
			.update(backupSchedulesTable)
			.set({ ...status, updatedAt: Date.now() })
			.where(and(eq(backupSchedulesTable.id, scheduleId), eq(backupSchedulesTable.organizationId, organizationId)));
	},
};

export const mirrorQueries = {
	findEnabledBySchedule: async (scheduleId: number) => {
		const mirrors = await db.query.backupScheduleMirrorsTable.findMany({
			where: { scheduleId },
			with: { repository: true },
		});
		return mirrors.filter((m) => m.enabled);
	},

	updateStatus: async (
		mirrorId: number,
		status: {
			lastCopyAt: number;
			lastCopyStatus: MirrorStatusType;
			lastCopyError: string | null;
		},
	) => {
		return db.update(backupScheduleMirrorsTable).set(status).where(eq(backupScheduleMirrorsTable.id, mirrorId));
	},
};

export const repositoryQueries = {
	findById: async (repositoryId: string, organizationId: string) => {
		return db.query.repositoriesTable.findFirst({
			where: { AND: [{ id: repositoryId }, { organizationId }] },
		});
	},
};
