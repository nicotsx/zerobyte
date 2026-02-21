import { describe, expect, test } from "bun:test";
import { normalizeAbsolutePath } from "../path";

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
