import type { BackupSchedule } from "~/client/lib/types";
import { cronToFormValues } from "../../lib/cron-utils";
import type { InternalFormValues } from "./types";

export const parseMultilineEntries = (value?: string) => {
	if (!value) {
		return [];
	}

	return value
		.split("\n")
		.map((entry) => entry.trim())
		.filter(Boolean);
};

export const toWebhookConfig = (url?: string, headers?: string, body?: string) => {
	const trimmedUrl = url?.trim();
	const parsedHeaders = parseMultilineEntries(headers);

	return trimmedUrl
		? {
				url: trimmedUrl,
				headers: parsedHeaders.length > 0 ? parsedHeaders : undefined,
				body: body === "" ? undefined : body,
			}
		: null;
};

export const backupScheduleToFormValues = (schedule?: BackupSchedule): InternalFormValues | undefined => {
	if (!schedule) {
		return undefined;
	}

	const cronValues = cronToFormValues(schedule.cronExpression ?? "");

	return {
		name: schedule.name,
		repositoryId: schedule.repository.shortId,
		includePaths: schedule.includePaths?.length ? schedule.includePaths : undefined,
		includePatterns: schedule.includePatterns?.length ? schedule.includePatterns.join("\n") : undefined,
		excludePatternsText: schedule.excludePatterns?.join("\n") || undefined,
		excludeIfPresentText: schedule.excludeIfPresent?.join("\n") || undefined,
		oneFileSystem: schedule.oneFileSystem ?? false,
		customResticParamsText: schedule.customResticParams?.join("\n") ?? "",
		preBackupWebhookUrl: schedule.backupWebhooks?.pre?.url ?? "",
		preBackupWebhookHeadersText: schedule.backupWebhooks?.pre?.headers?.join("\n") ?? "",
		preBackupWebhookBody: schedule.backupWebhooks?.pre?.body ?? "",
		postBackupWebhookUrl: schedule.backupWebhooks?.post?.url ?? "",
		postBackupWebhookHeadersText: schedule.backupWebhooks?.post?.headers?.join("\n") ?? "",
		postBackupWebhookBody: schedule.backupWebhooks?.post?.body ?? "",
		maxRetries: schedule.maxRetries?.toString(),
		retryDelay: schedule.retryDelay?.toString(),
		...cronValues,
		keepLast: schedule.retentionPolicy?.keepLast?.toString(),
		keepHourly: schedule.retentionPolicy?.keepHourly?.toString(),
		keepDaily: schedule.retentionPolicy?.keepDaily?.toString(),
		keepWeekly: schedule.retentionPolicy?.keepWeekly?.toString(),
		keepMonthly: schedule.retentionPolicy?.keepMonthly?.toString(),
		keepYearly: schedule.retentionPolicy?.keepYearly?.toString(),
	};
};
