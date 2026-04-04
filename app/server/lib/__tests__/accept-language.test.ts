import { describe, expect, test } from "vitest";
import { getLocaleFromAcceptLanguage } from "~/server/lib/accept-language";

describe("getLocaleFromAcceptLanguage", () => {
	test("strips quality values from a single preferred language", () => {
		expect(getLocaleFromAcceptLanguage("en;q=0.5")).toBe("en");
	});

	test("prefers the highest quality language", () => {
		expect(getLocaleFromAcceptLanguage("en;q=0.5, fr;q=0.9")).toBe("fr");
	});

	test("treats language tags without q as the highest priority", () => {
		expect(getLocaleFromAcceptLanguage("en;q=0.9, fr-CH")).toBe("fr-CH");
	});

	test("skips invalid language tags and uses the next valid one", () => {
		expect(getLocaleFromAcceptLanguage("*, en-GB;q=0.8")).toBe("en-GB");
	});

	test("falls back to en-US when no valid language is present", () => {
		expect(getLocaleFromAcceptLanguage(";;;, ???")).toBe("en-US");
		expect(getLocaleFromAcceptLanguage(null)).toBe("en-US");
	});
});
