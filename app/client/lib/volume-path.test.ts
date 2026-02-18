import { describe, expect, test } from "bun:test";
import { getVolumeMountPath } from "./volume-path";
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
