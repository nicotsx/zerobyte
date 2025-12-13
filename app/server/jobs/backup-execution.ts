import { Job } from "../core/scheduler";
import { backupsService } from "../modules/backups/backups.service";
import { toMessage } from "../utils/errors";
import { logger } from "../utils/logger";

export class BackupExecutionJob extends Job {
	async run() {
		logger.debug("Checking for backup schedules to execute...");

		const scheduleIds = await backupsService.getSchedulesToExecute();

		if (scheduleIds.length === 0) {
			logger.debug("No backup schedules to execute");
			return { done: true, timestamp: new Date(), executed: 0 };
		}

		logger.info(`Found ${scheduleIds.length} backup schedule(s) to execute`);

		for (const scheduleId of scheduleIds) {
			backupsService.executeBackup(scheduleId).catch((error) => {
				logger.error(`Failed to execute backup for schedule ${scheduleId}: ${toMessage(error)}`);
			});
		}

		return { done: true, timestamp: new Date(), executed: scheduleIds.length };
	}
}
