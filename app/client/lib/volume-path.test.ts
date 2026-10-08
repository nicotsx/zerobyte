import { describe, expect, test } from "vitest";
import type { PresentedVolume } from "./types";
import { getVolumeMountPath } from "./volume-path";

const volumeBase = {
	id: 1,
	shortId: "abc123",
	name: "Archive",
	createdAt: 1,
	updatedAt: 1,
	lastHealthCheck: 1,
	status: "mounted",
	lastError: null,
	provisioningId: null,
	autoRemount: true,
	agentId: "local",
	sourceKind: "managed",
	trustedRootId: null,
	relativePath: null,
	sourceLocation: null,
} as const;

describe("getVolumeMountPath", () => {
	test("returns the configured path for directory volumes", () => {
		const volume = {
			...volumeBase,
			shortId: "abc123",
			config: { backend: "directory", path: "/mnt/data/projects", readOnly: false },
			type: "directory",
			path: "/mnt/data/projects",
		} satisfies PresentedVolume;

		expect(getVolumeMountPath(volume)).toBe("/mnt/data/projects");
	});

	test("returns the mounted data path for non-directory volumes", () => {
		const volume = {
			...volumeBase,
			shortId: "vol789",
			config: {
				backend: "nfs",
				server: "storage.internal",
				exportPath: "/exports/archive",
				version: "4.1",
			},
			type: "nfs",
			path: "/var/lib/zerobyte/volumes/vol789/_data",
		} satisfies PresentedVolume;

		expect(getVolumeMountPath(volume)).toBe("/var/lib/zerobyte/volumes/vol789/_data");
	});
});
