import { fromPartial } from "@total-typescript/shoehorn";
import { expect, test } from "vitest";
import {
	getDefaultRestoreMachine,
	getOriginalLocationUnavailableReason,
	getSnapshotBrowsePaths,
} from "./restore-context";
import { getVolumeMountPath } from "./volume-path";
import type { Volume } from "./types";

const server = { agentId: "local", name: null };
const nas = { agentId: "nas", name: "NAS" };

const localDirectory = fromPartial<Volume>({
	sourceKind: "managed",
	agentId: "local",
	config: { backend: "directory", path: "/mnt" },
});
const nasSource = fromPartial<Volume>({ sourceKind: "filesystem", agentId: "nas", config: null });

test("allows original paths for a writable matching local source", () => {
	const snapshot = { paths: ["/mnt/photos", "/mnt/documents"] };

	expect(getSnapshotBrowsePaths(snapshot, localDirectory)).toEqual({
		queryBasePath: "/mnt",
		displayBasePath: "/mnt",
	});
	expect(getOriginalLocationUnavailableReason(snapshot, localDirectory, server)).toBeNull();
});

test("requires a server destination for remote and unassociated snapshots", () => {
	for (const volume of [nasSource, undefined]) {
		expect(getOriginalLocationUnavailableReason({ paths: ["/mnt/photos"] }, volume, server)).toMatch(
			/source is not on this server/,
		);
	}
});

test.each([["C:\\photos"], ["/another/server/photos"]])(
	"requires a destination when snapshot paths do not match the local source: %j",
	(path) => {
		expect(getOriginalLocationUnavailableReason({ paths: [path] }, localDirectory, server)).toMatch(
			/source paths that do not match/,
		);
	},
);

test("requires a destination for a read-only local source", () => {
	const volume = fromPartial<Volume>({
		sourceKind: "managed",
		agentId: "local",
		shortId: "read-only",
		config: { backend: "nfs", readOnly: true },
	});

	expect(
		getOriginalLocationUnavailableReason({ paths: [`${getVolumeMountPath(volume)}/photos`] }, volume, server),
	).toMatch(/mounted read-only/);
});

test("allows original paths when the source is on the restore machine", () => {
	expect(getSnapshotBrowsePaths({ paths: ["/mnt/photos"] }, nasSource)).toEqual({
		queryBasePath: "/mnt/photos",
		displayBasePath: undefined,
	});
	expect(getOriginalLocationUnavailableReason({ paths: ["/mnt/photos"] }, nasSource, nas)).toBeNull();
});

test("requires a folder on the restore machine when the source is elsewhere", () => {
	const serverSource = fromPartial<Volume>({ sourceKind: "filesystem", agentId: "local", config: null });

	for (const volume of [serverSource, undefined]) {
		expect(getOriginalLocationUnavailableReason({ paths: ["/mnt/photos"] }, volume, nas)).toBe(
			"This snapshot's source is not on NAS. Restore the files to a folder on NAS instead.",
		);
	}
});

test("defaults to the source's machine when listed, otherwise the repository's machine", () => {
	expect(getDefaultRestoreMachine([server, nas], nasSource)).toBe(nas);
	expect(getDefaultRestoreMachine([server], nasSource)).toBe(server);
	expect(getDefaultRestoreMachine([server, nas], localDirectory)).toBe(server);
	expect(getDefaultRestoreMachine([server, nas], undefined)).toBe(server);
});
