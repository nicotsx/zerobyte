import { formatDistanceToNow, isValid } from "date-fns";

type DateInput = Date | string | number | null | undefined;

const getLocales = () => (typeof navigator !== "undefined" ? navigator.languages : undefined);

function formatValidDate(date: DateInput, formatter: (date: Date) => string): string {
	if (!date) return "Never";

	const parsedDate = new Date(date);
	if (!isValid(parsedDate)) return "Invalid Date";

	return formatter(parsedDate);
}

// 1/10/2026, 2:30 PM
export function formatDateTime(date: DateInput): string {
	return formatValidDate(date, (validDate) =>
		Intl.DateTimeFormat(getLocales(), {
			month: "numeric",
			day: "numeric",
			year: "numeric",
			hour: "numeric",
			minute: "numeric",
		}).format(validDate),
	);
}

// Jan 10, 2026
export function formatDateWithMonth(date: DateInput): string {
	return formatValidDate(date, (validDate) =>
		Intl.DateTimeFormat(getLocales(), {
			month: "short",
			day: "numeric",
			year: "numeric",
		}).format(validDate),
	);
}

// 1/10/2026
export function formatDate(date: DateInput): string {
	return formatValidDate(date, (validDate) =>
		Intl.DateTimeFormat(getLocales(), {
			month: "numeric",
			day: "numeric",
			year: "numeric",
		}).format(validDate),
	);
}

// 1/10
export function formatShortDate(date: DateInput): string {
	return formatValidDate(date, (validDate) =>
		Intl.DateTimeFormat(getLocales(), {
			month: "numeric",
			day: "numeric",
		}).format(validDate),
	);
}

// 1/10, 2:30 PM
export function formatShortDateTime(date: DateInput): string {
	return formatValidDate(date, (validDate) =>
		Intl.DateTimeFormat(getLocales(), {
			month: "numeric",
			day: "numeric",
			hour: "numeric",
			minute: "numeric",
		}).format(validDate),
	);
}

// 2:30 PM
export function formatTime(date: DateInput): string {
	return formatValidDate(date, (validDate) =>
		Intl.DateTimeFormat(getLocales(), {
			hour: "numeric",
			minute: "numeric",
		}).format(validDate),
	);
}

// 5 minutes ago
export function formatTimeAgo(date: DateInput): string {
	return formatValidDate(date, (validDate) => {
		const timeAgo = formatDistanceToNow(validDate, {
			addSuffix: true,
			includeSeconds: true,
		});

		return timeAgo.replace("about ", "").replace("over ", "").replace("almost ", "").replace("less than ", "");
	});
}
