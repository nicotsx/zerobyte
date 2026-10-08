import { describe, expect, test } from "vitest";
import { publicVolumeSchema, volumeSchema } from "@zerobyte/contracts/volumes";

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
			sourceKind: "filesystem",
			type: null,
			config: null,
			trustedRootId: "data",
			relativePath: "photos",
		});

		expect(managed.sourceKind).toBe("managed");
		expect(trusted.sourceKind).toBe("filesystem");
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
			sourceKind: "filesystem",
			type: "directory",
			config: { backend: "directory", path: "/data" },
			trustedRootId: null,
			relativePath: null,
		},
	])("rejects impossible source field combinations", (input) => {
		expect(volumeSchema.safeParse(input).success).toBe(false);
	});
});

describe("public volume schema", () => {
	test("returns the saved location without organization or presentation fields", () => {
		const volume = publicVolumeSchema.parse({
			...baseVolume,
			sourceKind: "filesystem",
			type: null,
			config: null,
			trustedRootId: "data",
			relativePath: "photos",
		});

		expect(volume).toMatchObject({ agentId: "agent-1", trustedRootId: "data", relativePath: "photos" });
		expect(volume).not.toHaveProperty("organizationId");
		expect(volume).not.toHaveProperty("path");
		expect(volume).not.toHaveProperty("sourceLocation");
	});
});
