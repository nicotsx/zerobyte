import { describe, expect, test } from "vitest";
import { createPathPrefixFns, getVolumeMountPath } from "./volume-path";
import { fromAny } from "@total-typescript/shoehorn";

describe("getVolumeMountPath", () => {
	test("returns the configured path for directory volumes", () => {
		const volume = {
			shortId: "abc123",
			config: {
				backend: "directory",
				path: "/mnt/data/projects",
			},
		};

		expect(getVolumeMountPath(fromAny(volume))).toBe("/mnt/data/projects");
	});

	test("returns the mounted data path for non-directory volumes", () => {
		const volume = {
			shortId: "vol789",
			config: {
				backend: "nfs",
			},
		};

		expect(getVolumeMountPath(fromAny(volume))).toBe("/var/lib/zerobyte/volumes/vol789/_data");
	});
});

describe("createPathPrefixFns", () => {
	test("strips the base path off a full path", () => {
		const fns = createPathPrefixFns("/home/billy");

		expect(fns.strip("/home/billy/code/foo")).toBe("/code/foo");
		expect(fns.strip("/home/billy")).toBe("/");
	});

	test("leaves a path outside the base path untouched", () => {
		const fns = createPathPrefixFns("/home/billy");

		expect(fns.strip("/etc/passwd")).toBe("/etc/passwd");
	});

	test("adds the base path back onto a display path", () => {
		const fns = createPathPrefixFns("/home/billy");

		expect(fns.add("/code/foo")).toBe("/home/billy/code/foo");
		expect(fns.add("/")).toBe("/home/billy");
	});

	test("is a no-op when the base path is the root", () => {
		const fns = createPathPrefixFns("/");

		expect(fns.strip("/code/foo")).toBe("/code/foo");
		expect(fns.add("/code/foo")).toBe("/code/foo");
	});
});
