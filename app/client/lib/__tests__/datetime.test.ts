import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
	formatDate,
	formatDateTime,
	formatDateWithMonth,
	formatShortDate,
	formatShortDateTime,
	formatTime,
	formatTimeAgo,
} from "../datetime";

afterEach(() => {
	mock.restore();
});

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
		const nowSpy = spyOn(Date, "now").mockReturnValue(new Date("2026-01-10T14:35:00.000Z").getTime());

		expect(formatTimeAgo(sampleDate)).toBe("5 minutes ago");

		nowSpy.mockRestore();
	});

	test("formats calendar values with an explicit locale and timezone", () => {
		expect(formatShortDateTime(sampleDate, { locale: "en-US", timeZone: "UTC" })).toBe("1/10, 2:30 PM");
	});
});
