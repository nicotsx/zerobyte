import { Scheduler } from "../../core/scheduler";
import { db } from "../../db/db";
import { logger } from "@zerobyte/core/node";
import { volumeService } from "../volumes/volume.service";
import { CleanupDanglingMountsJob } from "../../jobs/cleanup-dangling";
import { VolumeHealthCheckJob } from "../../jobs/healthchecks";
import { RepositoryHealthCheckJob } from "../../jobs/repository-healthchecks";
import { BackupExecutionJob } from "../../jobs/backup-execution";
import { repositoriesService } from "../repositories/repositories.service";
import { notificationsService } from "../notifications/notifications.service";
import { VolumeAutoRemountJob } from "~/server/jobs/auto-remount";
import { cache } from "~/server/utils/cache";
import { withContext } from "~/server/core/request-context";
import { backupsService } from "../backups/backups.service";
import { config } from "~/server/core/config";
import { syncProvisionedResources } from "../provisioning/provisioning";
import { toMessage } from "~/server/utils/errors";
import { LOCAL_AGENT_ID } from "../agents/constants";
import { RESTART_TASK_ERROR, taskStore } from "../tasks/tasks.store";

const ensureLatestConfigurationSchema = async () => {
	const volumes = await db.query.volumesTable.findMany({});

	for (const volume of volumes) {
		await withContext({ organizationId: volume.organizationId }, async () => {
			await volumeService.updateVolume(volume.shortId, volume).catch((err) => {
				logger.error(`Failed to update volume ${volume.name}: ${err}`);
			});
		});
	}

	const repositories = await db.query.repositoriesTable.findMany({});

	for (const repo of repositories) {
		await withContext({ organizationId: repo.organizationId }, async () => {
			await repositoriesService.updateRepository(repo.shortId, {}).catch((err) => {
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

	await syncProvisionedResources(config.provisioningPath).catch((error) => {
		logger.error(`Provisioning sync failed: ${toMessage(error)}`);
	});

	await ensureLatestConfigurationSchema();

	const { deletedSchedules } = await backupsService.cleanupOrphanedSchedules().catch((err) => {
		logger.error(`Failed to cleanup orphaned backup schedules on startup: ${err.message}`);
		return { deletedSchedules: 0 };
	});

	if (deletedSchedules > 0) {
		logger.warn(`Removed ${deletedSchedules} orphaned backup schedule(s) during startup`);
	}

	if (!config.flags.enableLocalAgent) {
		const volumes = await db.query.volumesTable.findMany({
			where: {
				AND: [
					{ agentId: LOCAL_AGENT_ID },
					{
						OR: [
							{ status: "mounted" },
							{
								AND: [{ autoRemount: true }, { status: "error" }],
							},
						],
					},
				],
			},
		});

		for (const volume of volumes) {
			await withContext({ organizationId: volume.organizationId }, async () => {
				await volumeService.mountVolume(volume.shortId).catch((err) => {
					logger.error(`Error auto-remounting volume ${volume.name} on startup: ${err.message}`);
				});
			});
		}
	}

	let staleTasks: ReturnType<typeof taskStore.markActiveStale> = [];
	try {
		staleTasks = taskStore.markActiveStale({ error: RESTART_TASK_ERROR });
		if (staleTasks.length > 0) {
			logger.warn(`Marked ${staleTasks.length} active task(s) stale during startup`);
		}
	} catch (err) {
		logger.error(`Failed to mark stale tasks on startup: ${toMessage(err)}`);
	}

	await backupsService.recoverInterruptedBackups(staleTasks).catch((err) => {
		logger.error(`Failed to recover interrupted backup schedules on startup: ${err.message}`);
	});

	if (!config.flags.enableLocalAgent) {
		Scheduler.build(CleanupDanglingMountsJob).schedule("0 * * * *");
	}
	Scheduler.build(VolumeHealthCheckJob).schedule("*/30 * * * *");
	Scheduler.build(RepositoryHealthCheckJob).schedule("50 12 * * *");
	Scheduler.build(BackupExecutionJob).schedule("* * * * *");
	Scheduler.build(VolumeAutoRemountJob).schedule("*/5 * * * *");
};
