import { CronExpressionParser } from "cron-parser";
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

export const validateScheduleTiming = (schedule: { cronExpression: string; enabled: boolean }) => {
	if (schedule.cronExpression && !isValidCron(schedule.cronExpression)) {
		return "Invalid cron expression";
	}

	if (schedule.enabled && !schedule.cronExpression) {
		return "Enabled schedules require a cron expression";
	}

	return null;
};
