import { type } from "arktype";
import { deepClean } from "~/utils/object";

export const internalFormSchema = type({
	name: "1 <= string <= 128",
	repositoryId: "string",
	excludePatternsText: "string?",
	excludeIfPresentText: "string?",
	includePatternsText: "string?",
	includePatterns: "string[]?",
	frequency: "string",
	dailyTime: "string?",
	weeklyDay: "string?",
	monthlyDays: "string[]?",
	cronExpression: "string?",
	keepLast: "number?",
	keepHourly: "number?",
	keepDaily: "number?",
	keepWeekly: "number?",
	keepMonthly: "number?",
	keepYearly: "number?",
	oneFileSystem: "boolean?",
});

export const cleanSchema = type.pipe((d) => internalFormSchema(deepClean(d)));

export const weeklyDays = [
	{ label: "Monday", value: "1" },
	{ label: "Tuesday", value: "2" },
	{ label: "Wednesday", value: "3" },
	{ label: "Thursday", value: "4" },
	{ label: "Friday", value: "5" },
	{ label: "Saturday", value: "6" },
	{ label: "Sunday", value: "0" },
];

export type InternalFormValues = typeof internalFormSchema.infer;

export type BackupScheduleFormValues = Omit<
	InternalFormValues,
	"excludePatternsText" | "excludeIfPresentText" | "includePatternsText"
> & {
	excludePatterns?: string[];
	excludeIfPresent?: string[];
};
