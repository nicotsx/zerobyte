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
	rcloneConfigFile: "/root/.config/rclone/rclone.conf",
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

		await copy(sourceConfig, destConfig, { organizationId: "org-1", snapshotIds: ["--help"], tag: "daily" }, mockDeps);

		const separatorIndex = getArgs().indexOf("--");
		expect(separatorIndex).toBeGreaterThan(-1);
		expect(getArgs().slice(separatorIndex + 1)).toEqual(["--help"]);
	});

	test("defaults to 'latest' when no snapshotIds are provided", async () => {
		const { getArgs } = setup();

		await copy(sourceConfig, destConfig, { organizationId: "org-1", tag: "daily" }, mockDeps);

		const separatorIndex = getArgs().indexOf("--");
		expect(separatorIndex).toBeGreaterThan(-1);
		expect(getArgs().slice(separatorIndex + 1)).toEqual(["latest"]);
	});

	test("passes multiple snapshot IDs after separator", async () => {
		const { getArgs } = setup();

		await copy(
			sourceConfig,
			destConfig,
			{ organizationId: "org-1", snapshotIds: ["abc123", "def456", "ghi789"], tag: "daily" },
			mockDeps,
		);

		const separatorIndex = getArgs().indexOf("--");
		expect(separatorIndex).toBeGreaterThan(-1);
		expect(getArgs().slice(separatorIndex + 1)).toEqual(["abc123", "def456", "ghi789"]);
	});

	test("defaults to 'latest' when snapshotIds is empty array", async () => {
		const { getArgs } = setup();

		await copy(sourceConfig, destConfig, { organizationId: "org-1", snapshotIds: [], tag: "daily" }, mockDeps);

		const separatorIndex = getArgs().indexOf("--");
		expect(separatorIndex).toBeGreaterThan(-1);
		expect(getArgs().slice(separatorIndex + 1)).toEqual(["latest"]);
	});
});
