import type { BackupSchedule } from "~/client/lib/types";
import { cronToFormValues } from "../../lib/cron-utils";
import type { InternalFormValues } from "./types";

export const parseMultilineEntries = (value?: string) =>
	value
		? value
				.split("\n")
				.map((entry) => entry.trim())
				.filter(Boolean)
		: [];

export const parseWebhookHeaders = (headers?: string[]) => {
	const parsedHeaders = headers?.map((header) => header.trim()).filter(Boolean) ?? [];

	return parsedHeaders.length > 0 ? parsedHeaders : undefined;
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
		preBackupWebhookUrl: schedule.preBackupWebhook?.url ?? "",
		preBackupWebhookHeaders: schedule.preBackupWebhook?.headers ?? [],
		preBackupWebhookBody: schedule.preBackupWebhook?.body ?? "",
		postBackupWebhookUrl: schedule.postBackupWebhook?.url ?? "",
		postBackupWebhookHeaders: schedule.postBackupWebhook?.headers ?? [],
		postBackupWebhookBody: schedule.postBackupWebhook?.body ?? "",
		maxRetries: schedule.maxRetries,
		retryDelay: schedule.retryDelay,
		...cronValues,
		...schedule.retentionPolicy,
	};
};
