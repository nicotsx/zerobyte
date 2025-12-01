import { Scheduler } from "../../core/scheduler";
import { and, eq, or } from "drizzle-orm";
import { db } from "../../db/db";
import { volumesTable } from "../../db/schema";
import { logger } from "../../utils/logger";
import { restic } from "../../utils/restic";
import { volumeService } from "../volumes/volume.service";
import { CleanupDanglingMountsJob } from "../../jobs/cleanup-dangling";
import { VolumeHealthCheckJob } from "../../jobs/healthchecks";
import { RepositoryHealthCheckJob } from "../../jobs/repository-healthchecks";
import { BackupExecutionJob } from "../../jobs/backup-execution";
import { CleanupSessionsJob } from "../../jobs/cleanup-sessions";

export const startup = async () => {
	await Scheduler.start();
	await Scheduler.clear();

	await restic.ensurePassfile().catch((err) => {
		logger.error(`Error ensuring restic passfile exists: ${err.message}`);
	});

	const volumes = await db.query.volumesTable.findMany({
		where: or(
			eq(volumesTable.status, "mounted"),
			and(eq(volumesTable.autoRemount, true), eq(volumesTable.status, "error")),
		),
	});

	for (const volume of volumes) {
		await volumeService.mountVolume(volume.name).catch((err) => {
			logger.error(`Error auto-remounting volume ${volume.name} on startup: ${err.message}`);
		});
	}

	Scheduler.build(CleanupDanglingMountsJob).schedule("0 * * * *");
	Scheduler.build(VolumeHealthCheckJob).schedule("*/30 * * * *");
	Scheduler.build(RepositoryHealthCheckJob).schedule("50 12 * * *");
	Scheduler.build(BackupExecutionJob).schedule("* * * * *");
	Scheduler.build(CleanupSessionsJob).schedule("0 0 * * *");
};
