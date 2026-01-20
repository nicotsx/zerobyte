import { Scheduler } from "../../core/scheduler";
import { and, eq, or } from "drizzle-orm";
import { db } from "../../db/db";
import { backupSchedulesTable, volumesTable } from "../../db/schema";
import { logger } from "../../utils/logger";
import { restic } from "../../utils/restic";
import { volumeService } from "../volumes/volume.service";
import { CleanupDanglingMountsJob } from "../../jobs/cleanup-dangling";
import { VolumeHealthCheckJob } from "../../jobs/healthchecks";
import { RepositoryHealthCheckJob } from "../../jobs/repository-healthchecks";
import { BackupExecutionJob } from "../../jobs/backup-execution";
import { repositoriesService } from "../repositories/repositories.service";
import { notificationsService } from "../notifications/notifications.service";
import { VolumeAutoRemountJob } from "~/server/jobs/auto-remount";
import { cache } from "~/server/utils/cache";
import { initAuth } from "~/lib/auth";
import { toMessage } from "~/server/utils/errors";
import { withContext } from "~/server/core/request-context";

const ensureLatestConfigurationSchema = async () => {
	const volumes = await db.query.volumesTable.findMany({});

	for (const volume of volumes) {
		await withContext({ organizationId: volume.organizationId }, async () => {
			await volumeService.updateVolume(volume.id, volume).catch((err) => {
				logger.error(`Failed to update volume ${volume.name}: ${err}`);
			});
		});
	}

	const repositories = await db.query.repositoriesTable.findMany({});

	for (const repo of repositories) {
		await withContext({ organizationId: repo.organizationId }, async () => {
			await repositoriesService.updateRepository(repo.id, {}).catch((err) => {
				logger.error(`Failed to update repository ${repo.name}: ${err}`);
			});
		});
	}

	const notifications = await db.query.notificationDestinationsTable.findMany({});

	for (const notification of notifications) {
		await withContext({ organizationId: notification.organizationId }, async () => {
			await notificationsService.updateDestination(notification.id, notification).catch((err) => {
				logger.error(`Failed to update notification destination ${notification.id}: ${err}`);
			});
		});
	}
};

export const startup = async () => {
	cache.clear();

	await Scheduler.start();
	await Scheduler.clear();

	await restic.ensurePassfile().catch((err) => {
		logger.error(`Error ensuring restic passfile exists: ${err.message}`);
	});

	await initAuth().catch((err) => {
		logger.error(`Error initializing auth: ${toMessage(err)}`);
		throw err;
	});

	await ensureLatestConfigurationSchema();

	const volumes = await db.query.volumesTable.findMany({
		where: or(
			eq(volumesTable.status, "mounted"),
			and(eq(volumesTable.autoRemount, true), eq(volumesTable.status, "error")),
		),
	});

	for (const volume of volumes) {
		await withContext({ organizationId: volume.organizationId }, async () => {
			await volumeService.mountVolume(volume.id).catch((err) => {
				logger.error(`Error auto-remounting volume ${volume.name} on startup: ${err.message}`);
			});
		});
	}

	await db
		.update(backupSchedulesTable)
		.set({
			lastBackupStatus: "warning",
			lastBackupError: "Zerobyte was restarted during the last scheduled backup",
			updatedAt: Date.now(),
		})
		.where(eq(backupSchedulesTable.lastBackupStatus, "in_progress"))
		.catch((err) => {
			logger.error(`Failed to update stuck backup schedules on startup: ${err.message}`);
		});

	Scheduler.build(CleanupDanglingMountsJob).schedule("0 * * * *");
	Scheduler.build(VolumeHealthCheckJob).schedule("*/30 * * * *");
	Scheduler.build(RepositoryHealthCheckJob).schedule("50 12 * * *");
	Scheduler.build(BackupExecutionJob).schedule("* * * * *");
	Scheduler.build(VolumeAutoRemountJob).schedule("*/5 * * * *");
};
