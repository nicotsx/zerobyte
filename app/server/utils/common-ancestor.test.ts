import { describe, expect, test } from "bun:test";
import { findCommonAncestor } from "~/utils/common-ancestor";

describe("findCommonAncestor", () => {
	test("returns root for empty path lists", () => {
		expect(findCommonAncestor([])).toBe("/");
	});

	test("returns the original path for single-item lists", () => {
		expect(findCommonAncestor(["/var/lib/zerobyte/volumes/vol123/_data"])).toBe(
			"/var/lib/zerobyte/volumes/vol123/_data",
		);
	});

	test("returns the deepest shared ancestor for multiple absolute paths", () => {
		expect(
			findCommonAncestor([
				"/var/lib/zerobyte/volumes/vol123/_data/Documents/report.pdf",
				"/var/lib/zerobyte/volumes/vol123/_data/Photos/summer.jpg",
				"/var/lib/zerobyte/volumes/vol123/_data/Music/track.mp3",
			]),
		).toBe("/var/lib/zerobyte/volumes/vol123/_data");
	});

	test("returns root when absolute paths only share the filesystem root", () => {
		expect(findCommonAncestor(["/etc/hosts", "/usr/local/bin"])).toBe("/");
	});

	test("throws when any path is relative", () => {
		expect(() => findCommonAncestor(["/var/lib/zerobyte", "relative/path"])).toThrow(
			'Path "relative/path" is not absolute.',
		);
	});
});
