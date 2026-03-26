import { formatDistanceToNow, isValid } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { Route as RootRoute } from "~/routes/__root";

export type DateInput = Date | string | number | null | undefined;

export const DATE_FORMATS = ["MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"] as const;
export type DateFormatPreference = (typeof DATE_FORMATS)[number];
export const DEFAULT_DATE_FORMAT: DateFormatPreference = "MM/DD/YYYY";

export const TIME_FORMATS = ["12h", "24h"] as const;
export type TimeFormatPreference = (typeof TIME_FORMATS)[number];
export const DEFAULT_TIME_FORMAT: TimeFormatPreference = "12h";

const DATE_PART_ORDERS = {
	"MM/DD/YYYY": ["month", "day", "year"],
	"DD/MM/YYYY": ["day", "month", "year"],
	"YYYY/MM/DD": ["year", "month", "day"],
} as const;

const SHORT_DATE_PART_ORDERS = {
	"MM/DD/YYYY": ["month", "day"],
	"DD/MM/YYYY": ["day", "month"],
	"YYYY/MM/DD": ["month", "day"],
} as const;

type DateFormatOptions = {
	locale?: string | string[];
	timeZone?: string;
	dateFormat?: DateFormatPreference;
	timeFormat?: TimeFormatPreference;
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

function getRequiredPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
	const value = parts.find((part) => part.type === type)?.value;

	if (!value) {
		throw new Error(`Missing ${type} in formatted date`);
	}

	return value;
}

function formatConfiguredDate(date: Date, options: DateFormatOptions, includeYear: boolean) {
	const dateFormat = options.dateFormat ?? DEFAULT_DATE_FORMAT;
	const safeDateFormat = DATE_FORMATS.includes(dateFormat) ? dateFormat : DEFAULT_DATE_FORMAT;
	const parts = getDateTimeFormat(options.locale, options.timeZone, {
		month: "numeric",
		day: "numeric",
		year: "numeric",
	}).formatToParts(date);
	const values = {
		month: getRequiredPart(parts, "month"),
		day: getRequiredPart(parts, "day"),
		year: getRequiredPart(parts, "year"),
	};
	const order = includeYear ? DATE_PART_ORDERS[safeDateFormat] : SHORT_DATE_PART_ORDERS[safeDateFormat];

	return order.map((part) => values[part]).join("/");
}

function formatConfiguredDateWithMonth(date: Date, options: DateFormatOptions) {
	const dateFormat = options.dateFormat ?? DEFAULT_DATE_FORMAT;
	const parts = getDateTimeFormat(options.locale, options.timeZone, {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).formatToParts(date);
	const month = getRequiredPart(parts, "month");
	const day = getRequiredPart(parts, "day");
	const year = getRequiredPart(parts, "year");

	if (dateFormat === "DD/MM/YYYY") {
		return `${day} ${month} ${year}`;
	}

	if (dateFormat === "YYYY/MM/DD") {
		return `${year} ${month} ${day}`;
	}

	return `${month} ${day}, ${year}`;
}

function formatConfiguredTime(date: Date, options: DateFormatOptions) {
	return getDateTimeFormat(options.locale, options.timeZone, {
		hour: "numeric",
		minute: "numeric",
		hour12: (options.timeFormat ?? DEFAULT_TIME_FORMAT) === "12h",
	}).format(date);
}

// 1/10/2026, 2:30 PM
export function formatDateTime(date: DateInput, options: DateFormatOptions = {}): string {
	return formatValidDate(
		date,
		(validDate) => `${formatConfiguredDate(validDate, options, true)}, ${formatConfiguredTime(validDate, options)}`,
	);
}

// Jan 10, 2026
export function formatDateWithMonth(date: DateInput, options: DateFormatOptions = {}): string {
	return formatValidDate(date, (validDate) => formatConfiguredDateWithMonth(validDate, options));
}

// 1/10/2026
export function formatDate(date: DateInput, options: DateFormatOptions = {}): string {
	return formatValidDate(date, (validDate) => formatConfiguredDate(validDate, options, true));
}

// 1/10
export function formatShortDate(date: DateInput, options: DateFormatOptions = {}): string {
	return formatValidDate(date, (validDate) => formatConfiguredDate(validDate, options, false));
}

// 1/10, 2:30 PM
export function formatShortDateTime(date: DateInput, options: DateFormatOptions = {}): string {
	return formatValidDate(
		date,
		(validDate) => `${formatConfiguredDate(validDate, options, false)}, ${formatConfiguredTime(validDate, options)}`,
	);
}

// 2:30 PM
export function formatTime(date: DateInput, options: DateFormatOptions = {}): string {
	return formatValidDate(date, (validDate) => formatConfiguredTime(validDate, options));
}

// 5 minutes ago
export function formatTimeAgo(date: DateInput, now = Date.now()): string {
	return formatValidDate(date, (validDate) => {
		if (Math.abs(now - validDate.getTime()) < 120_000) {
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
	const { locale, timeZone, dateFormat, timeFormat, now } = RootRoute.useLoaderData();
	const [currentNow, setCurrentNow] = useState(now);

	useEffect(() => {
		const nextNow = Date.now();
		setCurrentNow(nextNow === now ? now : nextNow);
	}, [now]);

	return useMemo(
		() => ({
			formatDateTime: (date: DateInput) => formatDateTime(date, { locale, timeZone, dateFormat, timeFormat }),
			formatDateWithMonth: (date: DateInput) => formatDateWithMonth(date, { locale, timeZone, dateFormat, timeFormat }),
			formatDate: (date: DateInput) => formatDate(date, { locale, timeZone, dateFormat, timeFormat }),
			formatShortDate: (date: DateInput) => formatShortDate(date, { locale, timeZone, dateFormat, timeFormat }),
			formatShortDateTime: (date: DateInput) => formatShortDateTime(date, { locale, timeZone, dateFormat, timeFormat }),
			formatTime: (date: DateInput) => formatTime(date, { locale, timeZone, dateFormat, timeFormat }),
			formatTimeAgo: (date: DateInput) => formatTimeAgo(date, currentNow),
		}),
		[locale, timeZone, currentNow, dateFormat, timeFormat],
	);
}
