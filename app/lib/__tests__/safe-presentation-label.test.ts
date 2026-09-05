import { describe, expect, test } from "vitest";
import {
	ALLOWED_LOCATION_LABEL,
	getSafeAllowedLocationLabel,
	getSafeMachinePresentationLabel,
	getSafePresentationText,
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

	test("keeps bounded metadata text while rejecting unsafe values", () => {
		expect(getSafePresentationText("  archive-node  ", 255)).toBe("archive-node");
		expect(getSafePresentationText("archive\u202enode", 255)).toBeNull();
		expect(getSafePresentationText("a".repeat(129), 128)).toBeNull();
	});
});
