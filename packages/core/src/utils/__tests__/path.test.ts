import path from "node:path";
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
	hasPathListSeparator,
	isWindowsHostPath,
	isPathWithin,
	normalizeAbsolutePath,
	windowsHostPathToResticSnapshotPath,
	windowsResticSnapshotPathToHostPath,
} from "../path";

const safePathSegmentArb = fc
	.array(fc.constantFrom("a", "b", "c", "x", "y", "z", "0", "1", "2", "-", "_", ".", " "), {
		minLength: 1,
		maxLength: 12,
	})
	.map((chars) => chars.join(""))
	.filter((segment) => segment.trim() !== "" && segment !== "." && segment !== "..");

describe("normalizeAbsolutePath", () => {
	test("handles undefined and empty inputs", () => {
		expect(normalizeAbsolutePath()).toBe("/");
		expect(normalizeAbsolutePath("")).toBe("/");
		expect(normalizeAbsolutePath("   ")).toBe("/");
	});

	test("normalizes posix paths", () => {
		expect(normalizeAbsolutePath("/foo/bar")).toBe("/foo/bar");
		expect(normalizeAbsolutePath("foo/bar")).toBe("/foo/bar");
		expect(normalizeAbsolutePath("/foo//bar")).toBe("/foo/bar");
		expect(normalizeAbsolutePath("/foo/./bar")).toBe("/foo/bar");
		expect(normalizeAbsolutePath("/foo/../bar")).toBe("/bar");
	});

	test("trims trailing slashes", () => {
		expect(normalizeAbsolutePath("/foo/bar/")).toBe("/foo/bar");
		expect(normalizeAbsolutePath("/foo/bar//")).toBe("/foo/bar");
	});

	test("handles windows style paths from URI", () => {
		expect(normalizeAbsolutePath("foo\\\\bar")).toBe("/foo/bar");
		expect(normalizeAbsolutePath("foo\\\\bar\\\\")).toBe("/foo/bar");
	});

	test("handles URI encoded paths", () => {
		expect(normalizeAbsolutePath("/foo%20bar")).toBe("/foo bar");
		expect(normalizeAbsolutePath("foo%2Fbar")).toBe("/foo/bar");
	});

	test("preserves spaces inside path segments", () => {
		expect(normalizeAbsolutePath("! \\")).toBe("/! ");
		expect(normalizeAbsolutePath("/foo ")).toBe("/foo ");
		expect(normalizeAbsolutePath(" foo")).toBe("/ foo");
	});

	test("prevents parent traversal beyond root", () => {
		expect(normalizeAbsolutePath("..")).toBe("/");
		expect(normalizeAbsolutePath("/..")).toBe("/");
		expect(normalizeAbsolutePath("/foo/../../bar")).toBe("/bar");
	});

	test("is idempotent and always returns a normalized absolute path", () => {
		fc.assert(
			fc.property(fc.string({ maxLength: 200 }), (input) => {
				const normalized = normalizeAbsolutePath(input);

				expect(normalized.startsWith("/")).toBe(true);
				expect(normalized).not.toContain("\\");
				expect(normalized === "/" || !normalized.endsWith("/")).toBe(true);
				expect(normalizeAbsolutePath(normalized)).toBe(normalized);
			}),
		);
	});
});

describe("isPathWithin", () => {
	test("matches the same path and nested paths", () => {
		expect(isPathWithin("/var/lib/zerobyte", "/var/lib/zerobyte")).toBe(true);
		expect(isPathWithin("/var/lib/zerobyte", "/var/lib/zerobyte/data/restic.pass")).toBe(true);
	});

	test("does not match sibling or parent-escape paths", () => {
		expect(isPathWithin("/var/lib/zerobyte/data", "/var/lib/zerobyte/database")).toBe(false);
		expect(isPathWithin("/var/lib/zerobyte/data", "/var/lib/zerobyte/data/../ssh")).toBe(false);
	});

	test("matches descendants created under the same normalized base", () => {
		fc.assert(
			fc.property(
				fc.string({ maxLength: 80 }),
				fc.array(safePathSegmentArb, { maxLength: 5 }),
				(base, segments) => {
					const normalizedBase = normalizeAbsolutePath(base);
					const descendant = path.posix.join(normalizedBase, ...segments);

					expect(isPathWithin(base, descendant)).toBe(true);
				},
			),
		);
	});
});

describe("Windows restic snapshot path conversion", () => {
	test("maps native Windows host paths to restic snapshot paths", () => {
		expect(windowsHostPathToResticSnapshotPath("C:\\Users\\foo")).toBe("/C/Users/foo");
		expect(windowsHostPathToResticSnapshotPath("c:/Users/foo/")).toBe("/C/Users/foo");
	});

	test("does not treat bare drive letters as rooted Windows host paths", () => {
		expect(isWindowsHostPath("C:")).toBe(false);
		expect(windowsHostPathToResticSnapshotPath("C:")).toBeUndefined();
	});

	test("maps restic snapshot paths to native Windows host paths only when called explicitly", () => {
		expect(windowsResticSnapshotPathToHostPath("/C/Users/foo")).toBe("C:\\Users\\foo");
		expect(windowsResticSnapshotPathToHostPath("/d/source")).toBe("D:\\source");
	});
});

describe("path list character support", () => {
	test("allows line breaks in raw path lists", () => {
		expect(hasPathListSeparator("Photos", "raw")).toBe(false);
		expect(hasPathListSeparator("Photos\nSecrets", "raw")).toBe(false);
		expect(hasPathListSeparator("Photos\rSecrets", "raw")).toBe(false);
		expect(hasPathListSeparator("Photos\0Secrets", "raw")).toBe(true);
	});

	test("rejects line breaks in text path lists", () => {
		expect(hasPathListSeparator("Photos", "text")).toBe(false);
		expect(hasPathListSeparator("Photos\0Secrets", "text")).toBe(true);
		expect(hasPathListSeparator("Photos\nSecrets", "text")).toBe(true);
		expect(hasPathListSeparator("Photos\rSecrets", "text")).toBe(true);
	});
});
