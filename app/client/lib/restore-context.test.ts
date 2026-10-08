import { fromPartial } from "@total-typescript/shoehorn";
import { expect, test } from "vitest";
import { getRestoreContext } from "./restore-context";
import { getVolumeMountPath } from "./volume-path";
import type { Volume } from "./types";

const localDirectory = fromPartial<Volume>({
	sourceKind: "managed",
	agentId: "local",
	config: { backend: "directory", path: "/mnt" },
});

test("allows original paths for a writable matching local source", () => {
	expect(getRestoreContext({ paths: ["/mnt/photos", "/mnt/documents"] }, localDirectory)).toEqual({
		queryBasePath: "/mnt",
		displayBasePath: "/mnt",
		originalLocationUnavailableReason: null,
	});
});

test("requires a server destination for remote and unassociated snapshots", () => {
	const remote = fromPartial<Volume>({ sourceKind: "filesystem", agentId: "archive", config: null });
	for (const volume of [remote, undefined]) {
		expect(getRestoreContext({ paths: ["/mnt/photos"] }, volume).originalLocationUnavailableReason).toMatch(
			/source is not on this server/,
		);
	}
});

test.each([["C:\\photos"], ["/another/server/photos"]])(
	"requires a destination when snapshot paths do not match the local source: %j",
	(path) => {
		expect(getRestoreContext({ paths: [path] }, localDirectory).originalLocationUnavailableReason).toMatch(
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
		getRestoreContext({ paths: [`${getVolumeMountPath(volume)}/photos`] }, volume)
			.originalLocationUnavailableReason,
	).toMatch(/mounted read-only/);
});
