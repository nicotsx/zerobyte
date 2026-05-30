import { afterEach, describe, expect, test, vi } from "vitest";
import * as cleanupModule from "../../helpers/cleanup-temporary-keys";
import * as nodeModule from "../../../node";
import { deleteSnapshots } from "../delete-snapshots";
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

const config = {
	backend: "local" as const,
	path: "/tmp/restic-repo",
	isExistingRepository: true,
	customPassword: "custom-password",
};

const setup = () => {
	let capturedArgs: string[] = [];

	vi.spyOn(cleanupModule, "cleanupTemporaryKeys").mockImplementation(() => Promise.resolve());
	vi.spyOn(nodeModule, "safeExec").mockImplementation(async ({ args }) => {
		capturedArgs = args ?? [];
		return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
	});

	return {
		getArgs: () => capturedArgs,
	};
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("deleteSnapshots command", () => {
	test("treats flag-like snapshot IDs as positional args", async () => {
		const { getArgs } = setup();
		const snapshotIds = ["--help", "--password-command=sh -c 'id'"];

		await Effect.runPromise(deleteSnapshots(config, snapshotIds, { organizationId: "org-1" }, mockDeps));

		const separatorIndex = getArgs().indexOf("--");
		expect(separatorIndex).toBeGreaterThan(-1);
		expect(getArgs().slice(separatorIndex + 1)).toEqual(snapshotIds);
	});

	test("rejects empty snapshot IDs before building restic env", async () => {
		setup();
		const deps = {
			...mockDeps,
			resolveSecret: vi.fn(mockDeps.resolveSecret),
		};

		await expect(
			Effect.runPromise(deleteSnapshots(config, [], { organizationId: "org-1" }, deps)),
		).rejects.toMatchObject({
			message: "No snapshot IDs provided for deletion.",
		});

		expect(deps.resolveSecret).not.toHaveBeenCalled();
		expect(nodeModule.safeExec).not.toHaveBeenCalled();
		expect(cleanupModule.cleanupTemporaryKeys).not.toHaveBeenCalled();
	});
});
