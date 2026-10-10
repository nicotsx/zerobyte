import { describe, expect, test } from "vitest";
import { fromAny } from "@total-typescript/shoehorn";
import type { Volume } from "~/client/lib/types";
import { getBackupContextLabel, getBackupRunBlockReason, getRepositoryCompatibility } from "./backup-context";

const remoteVolume = (availability: string, status = "mounted"): Volume =>
	fromAny({
		name: "Family photos",
		sourceKind: "filesystem",
		agentId: "agent-1",
		status,
		sourceLocation: {
			availability,
			machine: { name: "Backup NAS" },
		},
	}) as Volume;

describe("backup context presentation", () => {
	test("keeps local source context quiet", () => {
		const volume = fromAny({ name: "Documents", sourceKind: "managed", agentId: "local" }) as Volume;
		expect(getBackupContextLabel(volume, "Archive")).toBe("Documents → Archive");
		expect(getBackupRunBlockReason(volume, fromAny({ type: "local" }))).toBeNull();
	});

	test("shows machine, source, and repository for remote sources", () => {
		expect(getBackupContextLabel(remoteVolume("available"), "Cloud archive")).toBe(
			"Backup NAS · Family photos → Cloud archive",
		);
	});

	test.each([
		[
			"disabled",
			"Remote agents are disabled on this instance. Contact the instance administrator to run this backup.",
		],
		["offline", "The remote agent for this source is offline. Reconnect it before running this backup."],
		[
			"connecting",
			"The remote agent for this source is connecting. Wait for it to be ready before running this backup.",
		],
		[
			"degraded",
			"The remote agent for this source has a degraded connection. Reconnect it before running this backup.",
		],
		[
			"not-ready",
			"The remote agent for this source is not ready. Wait for it to be ready before running this backup.",
		],
	])("blocks manual runs while a remote source is %s", (availability, reason) => {
		expect(getBackupRunBlockReason(remoteVolume(availability), fromAny({ type: "rest" }))).toBe(reason);
	});

	test.each([
		["local", "Local repositories are only available to sources on this server."],
		["rclone", "Rclone repositories use configuration on this server and are unavailable to remote sources."],
	] as const)("blocks legacy remote schedules using a %s repository", (type, reason) => {
		expect(getBackupRunBlockReason(remoteVolume("available"), fromAny({ type }))).toBe(reason);
	});

	test("allows an available remote source with a compatible repository", () => {
		expect(getBackupRunBlockReason(remoteVolume("available"), fromAny({ type: "s3" }))).toBeNull();
	});

	test("allows retrying an available source after its cached health check failed", () => {
		const volume = remoteVolume("available", "error");
		const blockReason = getBackupRunBlockReason(volume, fromAny({ type: "s3" }));

		expect(blockReason).toBeNull();
	});

	test("keeps incompatible repository choices diagnosable", () => {
		const compatibility = getRepositoryCompatibility(remoteVolume("available"), fromAny({ type: "rclone" }));
		expect(compatibility).toEqual({
			compatible: false,
			reason: "Rclone repositories use configuration on this server and are unavailable to remote sources.",
		});
	});
});
