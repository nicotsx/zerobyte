import { z } from "zod";

const webhookHeadersTextSchema = z
	.string()
	.optional()
	.refine(
		(value) => {
			const trimmed = value?.trim();
			if (!trimmed) {
				return true;
			}

			try {
				const parsed = JSON.parse(trimmed);
				return (
					parsed &&
					typeof parsed === "object" &&
					!Array.isArray(parsed) &&
					Object.values(parsed).every((headerValue) => typeof headerValue === "string")
				);
			} catch {
				return false;
			}
		},
		{ message: "Headers must be a JSON object with string values" },
	);

export const internalFormSchema = z.object({
	name: z.string().min(1).max(128),
	repositoryId: z.string(),
	excludePatternsText: z.string().optional(),
	excludeIfPresentText: z.string().optional(),
	includePatterns: z.string().optional(),
	includePaths: z.array(z.string()).optional(),
	frequency: z.string(),
	dailyTime: z.string().optional(),
	weeklyDay: z.string().optional(),
	monthlyDays: z.array(z.string()).optional(),
	cronExpression: z.string().optional(),
	keepLast: z.number().optional(),
	keepHourly: z.number().optional(),
	keepDaily: z.number().optional(),
	keepWeekly: z.number().optional(),
	keepMonthly: z.number().optional(),
	keepYearly: z.number().optional(),
	oneFileSystem: z.boolean().optional(),
	customResticParamsText: z.string().optional(),
	preBackupWebhookUrl: z.union([z.string().url(), z.literal("")]).optional(),
	preBackupWebhookHeadersText: webhookHeadersTextSchema,
	preBackupWebhookBody: z.string().optional(),
	postBackupWebhookUrl: z.union([z.string().url(), z.literal("")]).optional(),
	postBackupWebhookHeadersText: webhookHeadersTextSchema,
	postBackupWebhookBody: z.string().optional(),
	maxRetries: z.number().min(0).max(32).optional(),
	retryDelay: z.number().min(1).max(1440).optional(),
});

export const weeklyDays = [
	{ label: "Monday", value: "1" },
	{ label: "Tuesday", value: "2" },
	{ label: "Wednesday", value: "3" },
	{ label: "Thursday", value: "4" },
	{ label: "Friday", value: "5" },
	{ label: "Saturday", value: "6" },
	{ label: "Sunday", value: "0" },
];

export type InternalFormValues = z.infer<typeof internalFormSchema>;

export type BackupScheduleFormValues = Omit<
	InternalFormValues,
	| "excludePatternsText"
	| "excludeIfPresentText"
	| "includePatterns"
	| "customResticParamsText"
	| "preBackupWebhookUrl"
	| "preBackupWebhookHeadersText"
	| "preBackupWebhookBody"
	| "postBackupWebhookUrl"
	| "postBackupWebhookHeadersText"
	| "postBackupWebhookBody"
> & {
	excludePatterns?: string[];
	excludeIfPresent?: string[];
	includePatterns?: string[];
	customResticParams?: string[];
	preBackupWebhook?: { url: string; headers?: Record<string, string>; body?: string } | null;
	postBackupWebhook?: { url: string; headers?: Record<string, string>; body?: string } | null;
};
