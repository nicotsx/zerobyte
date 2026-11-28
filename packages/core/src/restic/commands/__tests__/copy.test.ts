import { afterEach, describe, expect, test, vi } from "vitest";
import * as cleanupModule from "../../helpers/cleanup-temporary-keys";
import * as nodeModule from "../../../node";
import type { SafeSpawnParams } from "../../../node/spawn";
import { copy } from "../copy";
import type { ResticDeps } from "../../types";
import { Effect } from "effect";

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
	let capturedParams: SafeSpawnParams | null = null;

	const cleanupMock = vi.spyOn(cleanupModule, "cleanupTemporaryKeys").mockImplementation(() => Promise.resolve());
	vi.spyOn(nodeModule, "safeSpawn").mockImplementation(async (params) => {
		capturedArgs = params.args;
		capturedParams = params;
		return { exitCode: 0, summary: "copied", error: "", stderr: "" };
	});

	return {
		getArgs: () => capturedArgs,
		getParams: () => capturedParams,
		cleanupMock,
	};
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("copy command", () => {
	test("treats flag-like snapshot IDs as positional args", async () => {
		const { getArgs } = setup();

		await Effect.runPromise(
			copy(
				sourceConfig,
				destConfig,
				{ organizationId: "org-1", snapshotIds: ["--help"], tag: "daily" },
				mockDeps,
			),
		);

		const separatorIndex = getArgs().indexOf("--");
		expect(separatorIndex).toBeGreaterThan(-1);
		expect(getArgs().slice(separatorIndex + 1)).toEqual(["--help"]);
	});

	test.each([
		{
			name: "concrete IDs",
			snapshotIds: ["abc123", "def456", "ghi789"],
			expectedSelectors: ["abc123", "def456", "ghi789"],
			expectedTagArgs: [],
		},
		{
			name: "omitted IDs",
			snapshotIds: undefined,
			expectedSelectors: ["latest"],
			expectedTagArgs: ["--tag", "daily"],
		},
		{ name: "empty IDs", snapshotIds: [], expectedSelectors: ["latest"], expectedTagArgs: ["--tag", "daily"] },
		{
			name: "explicit latest",
			snapshotIds: ["latest"],
			expectedSelectors: ["latest"],
			expectedTagArgs: ["--tag", "daily"],
		},
		{
			name: "concrete IDs and latest",
			snapshotIds: ["abc123", "latest"],
			expectedSelectors: ["abc123", "latest"],
			expectedTagArgs: ["--tag", "daily"],
		},
	])(
		"passes the snapshot selectors and tag for $name",
		async ({ snapshotIds, expectedSelectors, expectedTagArgs }) => {
			const { getArgs } = setup();

			await Effect.runPromise(
				copy(sourceConfig, destConfig, { organizationId: "org-1", snapshotIds, tag: "daily" }, mockDeps),
			);

			const args = getArgs();
			const separatorIndex = args.indexOf("--");
			expect(separatorIndex).toBeGreaterThan(-1);
			expect(args.slice(separatorIndex + 1)).toEqual(expectedSelectors);

			const flags = args.slice(0, separatorIndex);
			const tagIndex = flags.indexOf("--tag");
			const tagArgs = tagIndex === -1 ? [] : flags.slice(tagIndex, tagIndex + 2);
			expect(tagArgs).toEqual(expectedTagArgs);
		},
	);

	test("uses verbose text output and streams restic messages unchanged", async () => {
		const { getArgs, getParams } = setup();
		const onMessage = vi.fn();

		await Effect.runPromise(
			copy(sourceConfig, destConfig, { organizationId: "org-1", tag: "daily", onMessage }, mockDeps),
		);

		expect(getArgs()).toContain("--verbose");
		expect(getArgs()).not.toContain("--json");
		const resticMessage = "[0:01] 50.00%  1 / 2 packs copied";
		getParams()?.onStdout?.(resticMessage);
		expect(onMessage).toHaveBeenCalledWith(resticMessage);
	});

	test("passes only copy-compatible custom restic params", async () => {
		const { getArgs } = setup();

		await Effect.runPromise(
			copy(
				sourceConfig,
				destConfig,
				{
					organizationId: "org-1",
					tag: "daily",
					customResticParams: ["--pack-size 64", "--ignore-inode", "--no-cache"],
				},
				mockDeps,
			),
		);

		expect(getArgs()).toContain("--pack-size");
		expect(getArgs()).toContain("64");
		expect(getArgs()).toContain("--no-cache");
		expect(getArgs()).not.toContain("--ignore-inode");
	});

	test("cleans up both repository environments when restic fails", async () => {
		const { cleanupMock } = setup();
		vi.mocked(nodeModule.safeSpawn).mockResolvedValueOnce({
			exitCode: 1,
			summary: "",
			error: "copy failed",
			stderr: "copy failed",
		});

		await expect(
			Effect.runPromise(copy(sourceConfig, destConfig, { organizationId: "org-1", tag: "daily" }, mockDeps)),
		).rejects.toThrow("copy failed");

		expect(cleanupMock).toHaveBeenCalledTimes(2);
	});
});
