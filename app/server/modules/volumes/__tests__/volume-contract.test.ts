import { describe, expect, test } from "vitest";
import {
	presentedVolumeDetailSchema,
	presentedVolumeSchema,
	publicVolumeSchema,
	volumeSchema,
} from "@zerobyte/contracts/volumes";

const baseVolume = {
	id: 1,
	shortId: "source-1",
	name: "Source",
	createdAt: 0,
	updatedAt: 0,
	lastHealthCheck: 0,
	status: "mounted" as const,
	lastError: null,
	provisioningId: null,
	autoRemount: false,
	agentId: "agent-1",
	organizationId: "org-1",
};

describe("volumeSchema", () => {
	test("accepts both canonical source variants", () => {
		const managed = volumeSchema.parse({
			...baseVolume,
			sourceKind: "managed",
			type: "directory",
			config: { backend: "directory", path: "/data" },
			trustedRootId: null,
			relativePath: null,
		});
		const trusted = volumeSchema.parse({
			...baseVolume,
			sourceKind: "agent-filesystem",
			type: null,
			config: null,
			trustedRootId: "data",
			relativePath: "photos",
		});

		expect(managed.sourceKind).toBe("managed");
		expect(trusted.sourceKind).toBe("agent-filesystem");
	});

	test.each([
		{
			...baseVolume,
			sourceKind: "managed",
			type: null,
			config: null,
			trustedRootId: "data",
			relativePath: "photos",
		},
		{
			...baseVolume,
			sourceKind: "agent-filesystem",
			type: "directory",
			config: { backend: "directory", path: "/data" },
			trustedRootId: null,
			relativePath: null,
		},
	])("rejects impossible source field combinations", (input) => {
		expect(volumeSchema.safeParse(input).success).toBe(false);
	});
});

describe("public volume presentation schemas", () => {
	test("keeps presentation data out of canonical public volumes", () => {
		const canonical = publicVolumeSchema.parse({
			...baseVolume,
			sourceKind: "agent-filesystem",
			type: null,
			config: null,
			trustedRootId: "data",
			relativePath: "photos",
			sourceLocation: { availability: "offline" },
		});

		expect(canonical).not.toHaveProperty("sourceLocation");
	});

	test("requires an explicit source location for every presented variant", () => {
		const managed = {
			...baseVolume,
			sourceKind: "managed" as const,
			type: "directory" as const,
			config: { backend: "directory" as const, path: "/data" },
			trustedRootId: null,
			relativePath: null,
		};
		const trusted = {
			...baseVolume,
			sourceKind: "agent-filesystem" as const,
			type: null,
			config: null,
			trustedRootId: "data",
			relativePath: "photos",
		};

		expect(presentedVolumeSchema.safeParse(managed).success).toBe(false);
		expect(presentedVolumeSchema.safeParse({ ...managed, sourceLocation: null }).success).toBe(true);
		expect(presentedVolumeSchema.safeParse({ ...trusted, sourceLocation: null }).success).toBe(false);
	});

	test("keeps list items pathless and requires a string path for detail and mutation responses", () => {
		const presented = {
			...baseVolume,
			sourceKind: "managed" as const,
			type: "directory" as const,
			config: { backend: "directory" as const, path: "/data" },
			trustedRootId: null,
			relativePath: null,
			sourceLocation: null,
		};

		const listItem = presentedVolumeSchema.parse({ ...presented, path: "/data" });
		expect(listItem).not.toHaveProperty("path");
		expect(presentedVolumeDetailSchema.safeParse(presented).success).toBe(false);
		expect(presentedVolumeDetailSchema.safeParse({ ...presented, path: null }).success).toBe(false);
		expect(presentedVolumeDetailSchema.parse({ ...presented, path: "/data" }).path).toBe("/data");
	});
});
