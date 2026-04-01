import { afterEach, describe, expect, test, vi } from "vitest";
import * as cleanupModule from "../../helpers/cleanup-temporary-keys";
import * as nodeModule from "../../../node";
import { copy } from "../copy";
import type { ResticDeps } from "../../types";

const mockDeps: ResticDeps = {
	resolveSecret: async (s) => s,
	getOrganizationResticPassword: async () => "org-restic-password",
	resticCacheDir: "/tmp/restic-cache",
	resticPassFile: "/tmp/restic.pass",
	defaultExcludes: ["/tmp/restic.pass", "/var/lib/zerobyte/repositories"],
};

const sourceConfig = {
	backend: "local" as const,
	path: "/tmp/source-repo",
	isExistingRepository: true,
	customPassword: "source-password",
};

const destConfig = {
	backend: "local" as const,
	path: "/tmp/dest-repo",
	isExistingRepository: true,
	customPassword: "dest-password",
};

const setup = () => {
	let capturedArgs: string[] = [];

	vi.spyOn(cleanupModule, "cleanupTemporaryKeys").mockImplementation(() => Promise.resolve());
	vi.spyOn(nodeModule, "safeExec").mockImplementation(async ({ args }) => {
		capturedArgs = args ?? [];
		return { exitCode: 0, stdout: "copied", stderr: "", timedOut: false };
	});

	return {
		getArgs: () => capturedArgs,
	};
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("copy command", () => {
	test("treats flag-like snapshot IDs as positional args", async () => {
		const { getArgs } = setup();
		const snapshotId = "--help";

		await copy(sourceConfig, destConfig, { organizationId: "org-1", snapshotId, tag: "daily" }, mockDeps);

		expect(getArgs()).toEqual([
			"--repo",
			"/tmp/dest-repo",
			"copy",
			"--from-repo",
			"/tmp/source-repo",
			"--tag",
			"daily",
			"--json",
			"--",
			snapshotId,
		]);
	});
});
