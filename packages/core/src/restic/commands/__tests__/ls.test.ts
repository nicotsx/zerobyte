import { afterEach, describe, expect, test, vi } from "vitest";
import * as cleanupModule from "../../helpers/cleanup-temporary-keys";
import * as spawnModule from "../../../utils/spawn";
import { ls } from "../ls";
import type { ResticDeps } from "../../types";
import type { SafeSpawnParams } from "../../../utils/spawn";

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

const snapshotLine = JSON.stringify({
	time: "2025-01-01T00:00:00Z",
	tree: "abc",
	paths: ["/"],
	hostname: "host",
	id: "id",
	short_id: "short",
	struct_type: "snapshot",
	message_type: "snapshot",
});

const setup = () => {
	let capturedArgs: string[] = [];

	vi.spyOn(cleanupModule, "cleanupTemporaryKeys").mockImplementation(() => Promise.resolve());
	vi.spyOn(spawnModule, "safeSpawn").mockImplementation((params: SafeSpawnParams) => {
		capturedArgs = params.args;
		params.onStdout?.(snapshotLine);
		return Promise.resolve({ exitCode: 0, summary: snapshotLine, error: "" });
	});

	return {
		getArgs: () => capturedArgs,
	};
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("ls command", () => {
	test("treats flag-like snapshot and path values as positional args", async () => {
		const { getArgs } = setup();
		const snapshotId = "--password-command=sh -c 'id'";
		const path = "--help";

		await ls(config, snapshotId, "org-1", path, undefined, mockDeps);

		const separatorIndex = getArgs().indexOf("--");
		expect(separatorIndex).toBeGreaterThan(-1);
		expect(getArgs().slice(separatorIndex + 1)).toEqual([snapshotId, path]);
	});
});
