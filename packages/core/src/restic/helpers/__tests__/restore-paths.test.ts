import { describe, expect, test } from "vitest";
import { createRestorePathArgs, getResticRestoreRoot } from "../restore-paths";
import { findResticCommonAncestor, getRelativeResticPath } from "../snapshot-paths";

describe("getResticRestoreRoot", () => {
	test("keeps single-letter POSIX roots case-sensitive unless source paths are explicitly Windows", () => {
		expect(findResticCommonAncestor(["/a/foo", "/a/Foo/bar"])).toBe("/a");
		expect(getRelativeResticPath("/a/foo", "/a/Foo/bar")).toBe("../Foo/bar");
	});

	test("uses the case-insensitive Windows common ancestor for same-drive paths", () => {
		expect(getResticRestoreRoot(["/C/Users/Foo/Photos", "/c/users/foo/Documents"], undefined, "windows")).toBe(
			"/C/Users/Foo",
		);
	});

	test("uses the selected file parent for Windows restic paths", () => {
		expect(getResticRestoreRoot(["/C/Users/Foo/Downloads/DumpStack.log"], "file", "windows")).toBe(
			"/C/Users/Foo/Downloads",
		);
	});

	test("uses restic root for Windows paths spanning drives", () => {
		expect(getResticRestoreRoot(["/C/Users/Foo", "/D/Archive"], undefined, "windows")).toBe("/");
	});
});

describe("createRestorePathArgs", () => {
	test("uses the canonical Windows root for restore args and include patterns", () => {
		expect(
			createRestorePathArgs({
				snapshotId: "snap-1",
				target: "C:\\Users\\Foo",
				sourcePathKind: "windows",
				include: ["/C/Users/Foo/Photos", "/c/users/foo/Documents"],
			}),
		).toEqual({
			restoreArg: "snap-1:/C/Users/Foo",
			includePatterns: ["Photos", "Documents"],
			excludePatterns: [],
		});
	});

	test("restores multiple Windows drives from restic root for custom targets", () => {
		expect(
			createRestorePathArgs({
				snapshotId: "snap-1",
				target: "C:\\Restore",
				sourcePathKind: "windows",
				include: ["/C/Users/Foo", "/D/Archive"],
			}),
		).toEqual({
			restoreArg: "snap-1:/",
			includePatterns: ["C/Users/Foo", "D/Archive"],
			excludePatterns: [],
		});
	});

	test("keeps POSIX snapshot path names byte-for-byte", () => {
		expect(
			createRestorePathArgs({
				snapshotId: "snap-1",
				target: "/restore",
				sourcePathKind: "posix",
				include: ["/tmp/foo%2Fbar.txt"],
				selectedItemKind: "file",
			}),
		).toEqual({
			restoreArg: "snap-1:/tmp",
			includePatterns: ["foo%2Fbar.txt"],
			excludePatterns: [],
		});
	});

	test("preserves exclude patterns verbatim", () => {
		expect(
			createRestorePathArgs({
				snapshotId: "snap-1",
				target: "/restore",
				basePath: "/var/lib/app",
				exclude: ["*.tmp", "cache/[old]"],
			}),
		).toEqual({
			restoreArg: "snap-1:/var/lib/app",
			includePatterns: [],
			excludePatterns: ["*.tmp", "cache/[old]"],
		});
	});
});
