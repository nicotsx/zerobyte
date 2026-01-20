import { Job } from "../core/scheduler";
import { backupsService } from "../modules/backups/backups.service";
import { logger } from "../utils/logger";
import { db } from "../db/db";
import { withContext } from "../core/request-context";

export class BackupExecutionJob extends Job {
	async run() {
		logger.debug("Checking for backup schedules to execute...");

		const organizations = await db.query.organization.findMany({});

		let totalExecuted = 0;

		for (const org of organizations) {
			await withContext({ organizationId: org.id }, async () => {
				const scheduleIds = await backupsService.getSchedulesToExecute();

				if (scheduleIds.length === 0) {
					return;
				}

				logger.info(`Found ${scheduleIds.length} backup schedule(s) to execute for organization ${org.name}`);

				for (const scheduleId of scheduleIds) {
					backupsService.executeBackup(scheduleId).catch((err) => {
						logger.error(`Error executing backup for schedule ${scheduleId}:`, err);
					});
				}

				totalExecuted += scheduleIds.length;
			});
		}

		if (totalExecuted === 0) {
			logger.debug("No backup schedules to execute");
		}

		return { done: true, timestamp: new Date(), executed: totalExecuted };
	}
}
