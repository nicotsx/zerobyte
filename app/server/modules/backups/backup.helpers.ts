import { CronExpressionParser } from "cron-parser";
import { createBackupOptions as createAgentBackupOptions } from "../../../../apps/agent/src/commands/backup.helpers";
import type { BackupSchedule } from "~/server/db/schema";
import { toMessage } from "~/server/utils/errors";
import { logger } from "@zerobyte/core/node";

export const calculateNextRun = (cronExpression: string) => {
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

export const isValidCron = (expression: string) => {
	try {
		CronExpressionParser.parse(expression);
		return true;
	} catch {
		return false;
	}
};

export const createBackupOptions = (schedule: BackupSchedule, volumePath: string, signal?: AbortSignal) =>
	createAgentBackupOptions(
		{
			scheduleId: schedule.shortId,
			options: {
				oneFileSystem: schedule.oneFileSystem,
				excludePatterns: schedule.excludePatterns,
				excludeIfPresent: schedule.excludeIfPresent,
				includePaths: schedule.includePaths,
				includePatterns: schedule.includePatterns,
				customResticParams: schedule.customResticParams,
				compressionMode: "auto",
			},
		},
		volumePath,
		signal,
	);
