import { expect, test } from "vitest";
import { asShortId } from "~/server/utils/branded";
import type { VolumeRow } from "../schema";
import { readVolume } from "../volume";

const managedRow: VolumeRow = {
	id: 1,
	shortId: asShortId("source-1"),
	name: "Source",
	provisioningId: null,
	createdAt: 0,
	updatedAt: 0,
	lastHealthCheck: 0,
	status: "unmounted",
	lastError: null,
	autoRemount: true,
	agentId: "local",
	organizationId: "org-1",
	sourceKind: "managed",
	type: "directory",
	config: { backend: "directory", path: "/data" },
	trustedRootId: null,
	relativePath: null,
};

test("reads managed volumes without changing their stored configuration", () => {
	const volume = readVolume(managedRow);

	expect(volume).toEqual(managedRow);
	expect(volume.config).toBe(managedRow.config);
});

test("reads filesystem sources pointing to the trusted root itself", () => {
	const row: VolumeRow = {
		...managedRow,
		sourceKind: "filesystem",
		agentId: "agent-1",
		type: null,
		config: null,
		trustedRootId: "photos",
		relativePath: "",
	};

	expect(readVolume(row)).toEqual(row);
});

test.each<Partial<VolumeRow>>([
	{ config: null },
	{ type: null },
	{ trustedRootId: "photos" },
	{ sourceKind: "filesystem", config: null, type: null, trustedRootId: "photos", relativePath: null },
	{ sourceKind: "filesystem", trustedRootId: "photos", relativePath: "" },
])("rejects a stored row with incompatible source fields: %j", (fields) => {
	expect(() => readVolume({ ...managedRow, ...fields })).toThrow("Invalid stored source configuration");
});
