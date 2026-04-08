import { z } from "zod";

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
	"excludePatternsText" | "excludeIfPresentText" | "includePatterns" | "customResticParamsText"
> & {
	excludePatterns?: string[];
	excludeIfPresent?: string[];
	includePatterns?: string[];
	customResticParams?: string[];
};
