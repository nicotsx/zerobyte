export type CronFormValues = {
	frequency: string;
	dailyTime?: string;
	weeklyDay?: string;
	monthlyDays?: string[];
	cronExpression?: string;
};

const isSimpleNumber = (s: string) => /^\d+$/.test(s);
const isWildcard = (s: string) => s === "*";

type Matcher = (parts: string[]) => CronFormValues | null;

const matchers: Matcher[] = [
	// Hourly: 0 * * * *
	(parts) => {
		if (parts.length === 5 && parts[0] === "0" && parts.slice(1).every(isWildcard)) {
			return { frequency: "hourly" };
		}
		return null;
	},

	// Daily: mm hh * * *
	(parts) => {
		if (
			parts.length === 5 &&
			isSimpleNumber(parts[0]) &&
			isSimpleNumber(parts[1]) &&
			parts.slice(2).every(isWildcard)
		) {
			return {
				frequency: "daily",
				dailyTime: `${parts[1].padStart(2, "0")}:${parts[0].padStart(2, "0")}`,
			};
		}
		return null;
	},

	// Weekly: mm hh * * d
	(parts) => {
		if (
			parts.length === 5 &&
			isSimpleNumber(parts[0]) &&
			isSimpleNumber(parts[1]) &&
			isWildcard(parts[2]) &&
			isWildcard(parts[3]) &&
			isSimpleNumber(parts[4])
		) {
			return {
				frequency: "weekly",
				dailyTime: `${parts[1].padStart(2, "0")}:${parts[0].padStart(2, "0")}`,
				weeklyDay: parts[4],
			};
		}
		return null;
	},

	// Monthly: mm hh dd * *
	(parts) => {
		if (
			parts.length === 5 &&
			isSimpleNumber(parts[0]) &&
			isSimpleNumber(parts[1]) &&
			parts[2] !== "*" &&
			parts[2].split(",").every(isSimpleNumber) &&
			isWildcard(parts[3]) &&
			isWildcard(parts[4])
		) {
			return {
				frequency: "monthly",
				dailyTime: `${parts[1].padStart(2, "0")}:${parts[0].padStart(2, "0")}`,
				monthlyDays: parts[2].split(","),
			};
		}
		return null;
	},
];

export const cronToFormValues = (cronExpression: string): CronFormValues => {
	const normalized = cronExpression.trim().replace(/\s+/g, " ");
	const parts = normalized.split(" ");

	for (const matcher of matchers) {
		const result = matcher(parts);
		if (result) return result;
	}

	return {
		frequency: "cron",
		cronExpression: normalized,
	};
};
