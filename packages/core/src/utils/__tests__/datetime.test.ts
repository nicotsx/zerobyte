import { describe, expect, test } from "vitest";
import { inferDateTimePreferences } from "../datetime";

describe("inferDateTimePreferences", () => {
	test.each([
		["en-US", { dateFormat: "MM/DD/YYYY", timeFormat: "12h" }],
		["en-GB", { dateFormat: "DD/MM/YYYY", timeFormat: "24h" }],
		["ja-JP", { dateFormat: "YYYY/MM/DD", timeFormat: "24h" }],
	] as const)("infers preferences for %s", (locale, expected) => {
		expect(inferDateTimePreferences(locale)).toEqual(expected);
	});
});
