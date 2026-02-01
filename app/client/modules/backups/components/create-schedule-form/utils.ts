import type { BackupSchedule } from "~/client/lib/types";
import { cronToFormValues } from "../../lib/cron-utils";
import type { InternalFormValues } from "./types";

export const backupScheduleToFormValues = (
	schedule?: BackupSchedule,
): InternalFormValues | undefined => {
	if (!schedule) {
		return undefined;
	}

	const cronValues = cronToFormValues(schedule.cronExpression ?? "0 * * * *");

	const patterns = schedule.includePatterns || [];
	const isGlobPattern = (p: string) => /[*?[\]]/.test(p);
	const fileBrowserPaths = patterns.filter((p) => !isGlobPattern(p));
	const textPatterns = patterns.filter(isGlobPattern);

	return {
		name: schedule.name,
		repositoryId: schedule.repositoryId,
		includePatterns: fileBrowserPaths.length > 0 ? fileBrowserPaths : undefined,
		includePatternsText: textPatterns.length > 0 ? textPatterns.join("\n") : undefined,
		excludePatternsText: schedule.excludePatterns?.join("\n") || undefined,
		excludeIfPresentText: schedule.excludeIfPresent?.join("\n") || undefined,
		oneFileSystem: schedule.oneFileSystem ?? false,
		...cronValues,
		...schedule.retentionPolicy,
	};
};
