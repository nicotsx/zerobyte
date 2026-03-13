import { describe, expect, test } from "bun:test";
import { isPathWithin, normalizeAbsolutePath } from "@zerobyte/core/utils";

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

	test("prevents parent traversal beyond root", () => {
		expect(normalizeAbsolutePath("..")).toBe("/");
		expect(normalizeAbsolutePath("/..")).toBe("/");
		expect(normalizeAbsolutePath("/foo/../../bar")).toBe("/bar");
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
});
