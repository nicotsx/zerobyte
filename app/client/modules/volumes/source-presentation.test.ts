import { describe, expect, test } from "vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import type { Volume } from "~/client/lib/types";
import { getSourceLabel, getVolumeStatusLabel } from "./source-presentation";

const remoteVolume = fromPartial<Extract<Volume, { sourceKind: "filesystem" }>>({
	name: "Family",
	sourceKind: "filesystem",
	agentId: "nas",
	trustedRootId: "photos",
	relativePath: "family/albums",
	status: "mounted",
	sourceLocation: { machine: "Backup NAS", location: "Photos", path: "Photos/family/albums" },
});

describe("source presentation", () => {
	test("includes the machine label supplied with the source", () => {
		expect(getSourceLabel(remoteVolume)).toBe("Backup NAS · Family");
		expect(getSourceLabel({ ...remoteVolume, agentId: "local" })).toBe("Family");
	});

	test("labels filesystem availability from the server status", () => {
		expect(getVolumeStatusLabel(remoteVolume)).toBe("available");
		expect(getVolumeStatusLabel({ ...remoteVolume, status: "error" })).toBe("unavailable");
	});
});
