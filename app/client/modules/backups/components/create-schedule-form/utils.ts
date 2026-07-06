import type { BackupWebhookConfig } from "@zerobyte/core/backup-hooks";
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

type WebhookFormValues = {
	url?: string;
	insecureTls?: boolean;
	headersText?: string;
	body?: string;
};

export const toWebhookConfig = ({ url, headersText, body, insecureTls }: WebhookFormValues) => {
	const trimmedUrl = url?.trim();
	const parsedHeaders = parseMultilineEntries(headersText);

	return trimmedUrl
		? {
				url: trimmedUrl,
				headers: parsedHeaders.length > 0 ? parsedHeaders : undefined,
				body: body === "" ? undefined : body,
				insecureTls,
			}
		: null;
};

const scheduleWebhookToFormValues = (webhook: BackupWebhookConfig | null | undefined) => ({
	url: webhook?.url ?? "",
	insecureTls: webhook?.insecureTls ?? false,
	headersText: webhook?.headers?.join("\n") ?? "",
	body: webhook?.body ?? "",
});

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
		preBackupWebhook: scheduleWebhookToFormValues(schedule.backupWebhooks?.pre),
		postBackupWebhook: scheduleWebhookToFormValues(schedule.backupWebhooks?.post),
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
