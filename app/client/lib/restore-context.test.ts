import { fromPartial } from "@total-typescript/shoehorn";
import { expect, test } from "vitest";
import { getRestoreContext } from "./restore-context";
import { getVolumeMountPath } from "./volume-path";
import type { Repository, Volume } from "./types";

const localRepository = fromPartial<Repository>({ agentId: "local", agentName: null });
const nasRepository = fromPartial<Repository>({ agentId: "nas", agentName: "NAS" });

const localDirectory = fromPartial<Volume>({
	sourceKind: "managed",
	agentId: "local",
	config: { backend: "directory", path: "/mnt" },
});

test("allows original paths for a writable matching local source", () => {
	expect(getRestoreContext({ paths: ["/mnt/photos", "/mnt/documents"] }, localDirectory, localRepository)).toEqual({
		queryBasePath: "/mnt",
		displayBasePath: "/mnt",
		originalLocationUnavailableReason: null,
	});
});

test("requires a server destination for remote and unassociated snapshots", () => {
	const remote = fromPartial<Volume>({ sourceKind: "filesystem", agentId: "archive", config: null });
	for (const volume of [remote, undefined]) {
		expect(
			getRestoreContext({ paths: ["/mnt/photos"] }, volume, localRepository).originalLocationUnavailableReason,
		).toMatch(/source is not on this server/);
	}
});

test.each([["C:\\photos"], ["/another/server/photos"]])(
	"requires a destination when snapshot paths do not match the local source: %j",
	(path) => {
		expect(
			getRestoreContext({ paths: [path] }, localDirectory, localRepository).originalLocationUnavailableReason,
		).toMatch(/source paths that do not match/);
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
		getRestoreContext({ paths: [`${getVolumeMountPath(volume)}/photos`] }, volume, localRepository)
			.originalLocationUnavailableReason,
	).toMatch(/mounted read-only/);
});

test("allows original paths when the source is on the repository's machine", () => {
	const sameMachine = fromPartial<Volume>({ sourceKind: "filesystem", agentId: "nas", config: null });

	expect(getRestoreContext({ paths: ["/mnt/photos"] }, sameMachine, nasRepository)).toEqual({
		queryBasePath: "/mnt/photos",
		displayBasePath: undefined,
		originalLocationUnavailableReason: null,
	});
});

test("requires a folder on the repository's machine when its source is elsewhere", () => {
	const otherMachine = fromPartial<Volume>({ sourceKind: "filesystem", agentId: "local", config: null });

	for (const volume of [otherMachine, undefined]) {
		const { originalLocationUnavailableReason } = getRestoreContext(
			{ paths: ["/mnt/photos"] },
			volume,
			nasRepository,
		);
		expect(originalLocationUnavailableReason).toBe(
			"This snapshot's source is not on NAS. Restore the files to a folder on NAS instead.",
		);
	}
});
