import { intervalToDuration } from "date-fns";

export const getCronExpression = (
	frequency: string,
	dailyTime?: string,
	weeklyDay?: string,
	monthlyDays?: string[],
): string => {
	if (frequency === "hourly") {
		return "0 * * * *";
	}

	if (!dailyTime) {
		dailyTime = "02:00";
	}

	const [hours, minutes] = dailyTime.split(":");

	if (frequency === "daily") {
		return `${minutes} ${hours} * * *`;
	}

	if (frequency === "monthly") {
		const sortedDays = (monthlyDays || [])
			.map(Number)
			.filter((day) => day >= 1 && day <= 31)
			.sort((a, b) => a - b);
		const days = sortedDays.length > 0 ? sortedDays.join(",") : "1";
		return `${minutes} ${hours} ${days} * *`;
	}

	return `${minutes} ${hours} * * ${weeklyDay ?? "0"}`;
};

export const formatDuration = (seconds: number) => {
	const duration = intervalToDuration({ start: 0, end: seconds * 1000 });
	const parts: string[] = [];

	if (duration.days) parts.push(`${duration.days}d`);
	if (duration.hours) parts.push(`${duration.hours}h`);
	if (duration.minutes) parts.push(`${duration.minutes}m`);
	if (duration.seconds || parts.length === 0) parts.push(`${duration.seconds || 0}s`);

	return parts.join(" ");
};
