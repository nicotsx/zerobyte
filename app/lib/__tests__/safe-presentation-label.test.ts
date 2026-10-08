import { describe, expect, test } from "vitest";
import {
	ALLOWED_LOCATION_LABEL,
	getSafeAllowedLocationLabel,
	getSafeMachinePresentationLabel,
	isSafePresentationLabel,
	UNNAMED_MACHINE_LABEL,
} from "../safe-presentation-label";

describe("safe presentation labels", () => {
	test.each([
		["POSIX path", "/srv/private"],
		["relative POSIX path", "srv/private"],
		["tilde path", "~/home"],
		["bare tilde path", "~"],
		["user tilde path", "~backup"],
		["current directory", "."],
		["parent directory", ".."],
		["Windows drive path", "C:\\Users\\private"],
		["UNC path", "\\\\server\\private"],
		["backslash path", "private\\photos"],
		["control characters", "NAS\u0000private"],
		["format characters", "NAS\u202Eprivate"],
		["Unicode line separator", "NAS\u2028private"],
		["Unicode paragraph separator", "NAS\u2029private"],
		["leading Unicode line separator", "\u2028NAS"],
		["trailing Unicode paragraph separator", "NAS\u2029"],
	] as const)("replaces a %s", (_kind, value) => {
		expect(getSafeMachinePresentationLabel(value)).toBe(UNNAMED_MACHINE_LABEL);
		expect(getSafeAllowedLocationLabel(value)).toBe(ALLOWED_LOCATION_LABEL);
	});

	test.each(["~", "~backup", ".", "..", "  ~backup  ", "  ..  "])(
		"rejects the separator-free POSIX path spelling %s at the predicate boundary",
		(value) => {
			expect(isSafePresentationLabel(value)).toBe(false);
		},
	);

	test.each([
		"Family photos",
		"NAS 01",
		"Équipe Zürich",
		"Archive (read only)",
		"release-1.2.3",
		"nas.local",
		".env",
		"...",
	])("preserves the normal semantic label %s", (value) => {
		expect(isSafePresentationLabel(`  ${value}  `)).toBe(true);
		expect(getSafeMachinePresentationLabel(`  ${value}  `)).toBe(value);
		expect(getSafeAllowedLocationLabel(`  ${value}  `)).toBe(value);
	});

	test("uses stable fallbacks for empty labels", () => {
		expect(getSafeMachinePresentationLabel("   ")).toBe(UNNAMED_MACHINE_LABEL);
		expect(getSafeAllowedLocationLabel("   ")).toBe(ALLOWED_LOCATION_LABEL);
	});
});
