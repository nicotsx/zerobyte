import { afterEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_TIME_FORMAT, inferDateTimePreferences, rawFormatters } from "../datetime";

afterEach(() => {
	vi.restoreAllMocks();
});

const {
	formatDate,
	formatDateTime,
	formatDateWithMonth,
	formatShortDate,
	formatShortDateTime,
	formatTime,
	formatTimeAgo,
} = rawFormatters;

const sampleDate = new Date("2026-01-10T14:30:00.000Z");

describe("datetime formatters", () => {
	test.each([
		formatDateTime,
		formatDateWithMonth,
		formatDate,
		formatShortDate,
		formatShortDateTime,
		formatTime,
		formatTimeAgo,
	])("returns Never when no date is provided", (formatValue) => {
		expect(formatValue(null)).toBe("Never");
	});

	test.each([
		formatDateTime,
		formatDateWithMonth,
		formatDate,
		formatShortDate,
		formatShortDateTime,
		formatTime,
		formatTimeAgo,
	])("returns Invalid Date when the input cannot be parsed", (formatValue) => {
		expect(formatValue("not-a-date")).toBe("Invalid Date");
	});

	test("accepts Date, string, and timestamp inputs for calendar formatters", () => {
		const isoDate = sampleDate.toISOString();
		const timestamp = sampleDate.getTime();

		expect(formatDateTime(isoDate)).toBe(formatDateTime(sampleDate));
		expect(formatDateTime(timestamp)).toBe(formatDateTime(sampleDate));
		expect(formatDateWithMonth(isoDate)).toBe(formatDateWithMonth(sampleDate));
		expect(formatDate(timestamp)).toBe(formatDate(sampleDate));
		expect(formatShortDate(isoDate)).toBe(formatShortDate(sampleDate));
		expect(formatShortDateTime(timestamp)).toBe(formatShortDateTime(sampleDate));
		expect(formatTime(isoDate)).toBe(formatTime(sampleDate));
	});

	test("formats relative times without approximation prefixes", () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(new Date("2026-01-10T14:35:00.000Z").getTime());

		expect(formatTimeAgo(sampleDate)).toBe("5 minutes ago");

		nowSpy.mockRestore();
	});

	test("formats calendar values with an explicit locale and timezone", () => {
		expect(formatShortDateTime(sampleDate, { locale: "en-US", timeZone: "UTC" })).toBe("1/10, 2:30 PM");
	});

	test.each([
		["MM/DD/YYYY", "1/10/2026"],
		["DD/MM/YYYY", "10/1/2026"],
		["YYYY/MM/DD", "2026/1/10"],
	] as const)("formats numeric dates with %s order", (dateFormat, expected) => {
		expect(formatDate(sampleDate, { locale: "en-US", timeZone: "UTC", dateFormat })).toBe(expected);
	});

	test.each([
		["MM/DD/YYYY", "Jan 10, 2026"],
		["DD/MM/YYYY", "10 Jan 2026"],
		["YYYY/MM/DD", "2026 Jan 10"],
	] as const)("formats month dates with %s order", (dateFormat, expected) => {
		expect(formatDateWithMonth(sampleDate, { locale: "en-US", timeZone: "UTC", dateFormat })).toBe(expected);
	});

	test.each([
		[DEFAULT_TIME_FORMAT, "2:30 PM"],
		["24h", "14:30"],
	] as const)("formats times with %s clock", (timeFormat, expected) => {
		expect(formatTime(sampleDate, { locale: "en-US", timeZone: "UTC", timeFormat })).toBe(expected);
	});

	test.each([
		["en-US", { dateFormat: "MM/DD/YYYY", timeFormat: "12h" }],
		["en-GB", { dateFormat: "DD/MM/YYYY", timeFormat: "24h" }],
		["ja-JP", { dateFormat: "YYYY/MM/DD", timeFormat: "24h" }],
	] as const)("infers date and time preferences for %s", (locale, expected) => {
		expect(inferDateTimePreferences(locale)).toEqual(expected);
	});

	test("formats combined values with custom date and time preferences", () => {
		expect(
			formatDateTime(sampleDate, {
				locale: "en-US",
				timeZone: "UTC",
				dateFormat: "DD/MM/YYYY",
				timeFormat: "24h",
			}),
		).toBe("10/1/2026, 14:30");
	});
});
