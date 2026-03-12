import CronExpressionParser from "cron-parser";
import path from "node:path";
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

export const processPattern = (pattern: string, volumePath: string, relative = false) => {
	const isNegated = pattern.startsWith("!");
	const p = isNegated ? pattern.slice(1) : pattern;

	const ensurePatternIsWithinVolume = (candidate: string) => {
		const resolvedVolumePath = path.resolve(volumePath);
		const resolvedCandidatePath = path.resolve(volumePath, candidate);
		const relativePath = path.relative(resolvedVolumePath, resolvedCandidatePath);

		if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
			throw new Error(`Include pattern escapes volume root: ${pattern}`);
		}
	};

	if (!p.startsWith("/")) {
		if (!relative) return pattern;
		ensurePatternIsWithinVolume(p);
		const processed = path.join(volumePath, p);
		return isNegated ? `!${processed}` : processed;
	}

	if (relative) {
		ensurePatternIsWithinVolume(p.slice(1));
	}
	const processed = path.join(volumePath, p.slice(1));
	return isNegated ? `!${processed}` : processed;
};

export const createBackupOptions = (schedule: BackupSchedule, volumePath: string, signal: AbortSignal) => ({
	tags: [schedule.shortId],
	oneFileSystem: schedule.oneFileSystem,
	signal,
	exclude: schedule.excludePatterns ? schedule.excludePatterns.map((p) => processPattern(p, volumePath)) : undefined,
	excludeIfPresent: schedule.excludeIfPresent ?? undefined,
	include: schedule.includePatterns
		? schedule.includePatterns.map((p) => processPattern(p, volumePath, true))
		: undefined,
	customResticParams: schedule.customResticParams ?? undefined,
});
