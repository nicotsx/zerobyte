import { afterEach, describe, expect, test, vi } from "vitest";
import * as cleanupModule from "../../helpers/cleanup-temporary-keys";
import * as nodeModule from "../../../node";
import { snapshots } from "../snapshots";
import type { SafeSpawnParams } from "../../../node";
import type { ResticDeps } from "../../types";

const mockDeps: ResticDeps = {
	resolveSecret: async (s) => s,
	getOrganizationResticPassword: async () => "org-restic-password",
	resticCacheDir: "/tmp/restic-cache",
	resticPassFile: "/tmp/restic.pass",
	defaultExcludes: ["/tmp/restic.pass", "/var/lib/zerobyte/repositories"],
};

const config = {
	backend: "local" as const,
	path: "/tmp/restic-repo",
	isExistingRepository: true,
	customPassword: "custom-password",
};

const getOnStdout = (params: SafeSpawnParams) => {
	if (params.stdoutMode === "raw") {
		return undefined;
	}

	return params.onStdout;
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("snapshots command", () => {
	test("parses a streamed multi-line JSON array", async () => {
		const snapshotsOutput = [
			{
				hostname: "host",
				id: "snapshot-1",
				paths: ["/data"],
				short_id: "snapshot-1",
				tags: ["daily"],
				time: "2025-01-01T00:00:00Z",
			},
		];

		vi.spyOn(cleanupModule, "cleanupTemporaryKeys").mockImplementation(() => Promise.resolve());
		vi.spyOn(nodeModule, "safeSpawn").mockImplementation((params) => {
			const onStdout = getOnStdout(params);

			for (const line of JSON.stringify(snapshotsOutput, null, 2).split("\n")) {
				onStdout?.(line);
			}

			return Promise.resolve({ exitCode: 0, summary: "", error: "" });
		});

		const result = await snapshots(config, { organizationId: "org-1" }, mockDeps);

		expect(result).toEqual(snapshotsOutput);
	});
});
