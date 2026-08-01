export const getCronExpression = (
	frequency: string,
	dailyTime?: string,
	weeklyDay?: string,
	monthlyDays?: string[],
	cronExpression?: string,
): string => {
	if (frequency === "manual") {
		return "";
	}

	if (frequency === "cron" && cronExpression) {
		return cronExpression;
	}

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
