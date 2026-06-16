import { z } from "zod";
import type { BackupWebhooks } from "@zerobyte/core/backup-hooks";

const webhookHeadersSchema = z.string().refine(
	(value) =>
		value
			.split("\n")
			.map((header) => header.trim())
			.filter(Boolean)
			.every((header) => {
				const [key, value] = header.split(":", 2);

				return /^[A-Za-z0-9-]+$/.test(key.trim()) && (value?.trim().length ?? 0) > 0;
			}),
	{ message: "Headers must use non-empty Key: Value format with valid header names" },
);

const optionalNumberInputSchema = (numberSchema: z.ZodNumber = z.number()) =>
	z
		.string()
		.optional()
		.transform((value) => (value === "" || value === undefined ? undefined : Number(value)))
		.pipe(numberSchema.optional());

const optionalRetentionCountSchema = optionalNumberInputSchema();

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
	keepLast: optionalRetentionCountSchema,
	keepHourly: optionalRetentionCountSchema,
	keepDaily: optionalRetentionCountSchema,
	keepWeekly: optionalRetentionCountSchema,
	keepMonthly: optionalRetentionCountSchema,
	keepYearly: optionalRetentionCountSchema,
	oneFileSystem: z.boolean().optional(),
	customResticParamsText: z.string().optional(),
	preBackupWebhookUrl: z.union([z.url(), z.literal("")]).optional(),
	preBackupWebhookHeadersText: webhookHeadersSchema.optional(),
	preBackupWebhookBody: z.string().optional(),
	postBackupWebhookUrl: z.union([z.url(), z.literal("")]).optional(),
	postBackupWebhookHeadersText: webhookHeadersSchema.optional(),
	postBackupWebhookBody: z.string().optional(),
	maxRetries: optionalNumberInputSchema(z.number().min(0).max(32)),
	retryDelay: optionalNumberInputSchema(z.number().min(1).max(1440)),
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

export type InternalFormValues = z.input<typeof internalFormSchema>;
export type InternalFormOutputValues = z.output<typeof internalFormSchema>;

export type BackupScheduleFormValues = Omit<
	InternalFormOutputValues,
	| "excludePatternsText"
	| "excludeIfPresentText"
	| "includePatterns"
	| "keepLast"
	| "keepHourly"
	| "keepDaily"
	| "keepWeekly"
	| "keepMonthly"
	| "keepYearly"
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
	backupWebhooks?: BackupWebhooks | null;
	keepLast?: number;
	keepHourly?: number;
	keepDaily?: number;
	keepWeekly?: number;
	keepMonthly?: number;
	keepYearly?: number;
};
