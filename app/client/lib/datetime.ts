import { formatDistanceToNow, isValid } from "date-fns";
import { useMemo } from "react";
import { Route as RootRoute } from "~/routes/__root";

export type DateInput = Date | string | number | null | undefined;

type DateFormatOptions = {
	locale?: string | string[];
	timeZone?: string;
};

function formatValidDate(date: DateInput, formatter: (date: Date) => string): string {
	if (!date) return "Never";

	const parsedDate = new Date(date);
	if (!isValid(parsedDate)) return "Invalid Date";

	return formatter(parsedDate);
}

function getDateTimeFormat(
	locale: DateFormatOptions["locale"],
	timeZone: DateFormatOptions["timeZone"],
	options: Intl.DateTimeFormatOptions,
) {
	return Intl.DateTimeFormat(locale, {
		...options,
		timeZone,
	});
}

// 1/10/2026, 2:30 PM
export function formatDateTime(date: DateInput, options: DateFormatOptions = {}): string {
	return formatValidDate(date, (validDate) =>
		getDateTimeFormat(options.locale, options.timeZone, {
			month: "numeric",
			day: "numeric",
			year: "numeric",
			hour: "numeric",
			minute: "numeric",
		}).format(validDate),
	);
}

// Jan 10, 2026
export function formatDateWithMonth(date: DateInput, options: DateFormatOptions = {}): string {
	return formatValidDate(date, (validDate) =>
		getDateTimeFormat(options.locale, options.timeZone, {
			month: "short",
			day: "numeric",
			year: "numeric",
		}).format(validDate),
	);
}

// 1/10/2026
export function formatDate(date: DateInput, options: DateFormatOptions = {}): string {
	return formatValidDate(date, (validDate) =>
		getDateTimeFormat(options.locale, options.timeZone, {
			month: "numeric",
			day: "numeric",
			year: "numeric",
		}).format(validDate),
	);
}

// 1/10
export function formatShortDate(date: DateInput, options: DateFormatOptions = {}): string {
	return formatValidDate(date, (validDate) =>
		getDateTimeFormat(options.locale, options.timeZone, {
			month: "numeric",
			day: "numeric",
		}).format(validDate),
	);
}

// 1/10, 2:30 PM
export function formatShortDateTime(date: DateInput, options: DateFormatOptions = {}): string {
	return formatValidDate(date, (validDate) =>
		getDateTimeFormat(options.locale, options.timeZone, {
			month: "numeric",
			day: "numeric",
			hour: "numeric",
			minute: "numeric",
		}).format(validDate),
	);
}

// 2:30 PM
export function formatTime(date: DateInput, options: DateFormatOptions = {}): string {
	return formatValidDate(date, (validDate) =>
		getDateTimeFormat(options.locale, options.timeZone, {
			hour: "numeric",
			minute: "numeric",
		}).format(validDate),
	);
}

// 5 minutes ago
export function formatTimeAgo(date: DateInput): string {
	return formatValidDate(date, (validDate) => {
		if (Math.abs(Date.now() - validDate.getTime()) < 120_000) {
			return "just now";
		}

		const timeAgo = formatDistanceToNow(validDate, {
			addSuffix: true,
			includeSeconds: true,
		});

		return timeAgo.replace("about ", "").replace("over ", "").replace("almost ", "").replace("less than ", "");
	});
}

export function useTimeFormat() {
	const { locale, timeZone } = RootRoute.useLoaderData();

	return useMemo(
		() => ({
			formatDateTime: (date: DateInput) => formatDateTime(date, { locale, timeZone }),
			formatDateWithMonth: (date: DateInput) => formatDateWithMonth(date, { locale, timeZone }),
			formatDate: (date: DateInput) => formatDate(date, { locale, timeZone }),
			formatShortDate: (date: DateInput) => formatShortDate(date, { locale, timeZone }),
			formatShortDateTime: (date: DateInput) => formatShortDateTime(date, { locale, timeZone }),
			formatTime: (date: DateInput) => formatTime(date, { locale, timeZone }),
			formatTimeAgo,
		}),
		[locale, timeZone],
	);
}
