import { Effect } from "effect";
import { afterEach, describe, expect, test, vi } from "vitest";
import * as nodeModule from "../../node";
import * as cleanupModule from "../helpers/cleanup-temporary-keys";
import { createRestic } from "../server";
import type { ResticDeps } from "../types";

const mockDeps: ResticDeps = {
	resolveSecret: async (s) => s,
	getOrganizationResticPassword: async () => "org-restic-password",
	resticCacheDir: "/tmp/restic-cache",
	resticPassFile: "/tmp/restic.pass",
	defaultExcludes: ["/tmp/restic.pass", "/var/lib/zerobyte/repositories"],
	rcloneConfigFile: "/root/.config/rclone/rclone.conf",
};

const repositoryConfig = {
	backend: "local" as const,
	path: "/tmp/restic-repo",
	isExistingRepository: true,
	customPassword: "custom-password",
};

const sourceRepositoryConfig = {
	backend: "local" as const,
	path: "/tmp/source-restic-repo",
	isExistingRepository: true,
	customPassword: "source-password",
};

const destinationRepositoryConfig = {
	backend: "local" as const,
	path: "/tmp/destination-restic-repo",
	isExistingRepository: true,
	customPassword: "destination-password",
};

const backupSummary = JSON.stringify({
	message_type: "summary",
	files_new: 10,
	files_changed: 5,
	files_unmodified: 85,
	dirs_new: 2,
	dirs_changed: 1,
	dirs_unmodified: 17,
	data_blobs: 20,
	tree_blobs: 5,
	data_added: 1_048_576,
	total_files_processed: 100,
	total_bytes_processed: 2_097_152,
	total_duration: 12.34,
	snapshot_id: "abcd1234",
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("restic command lock recovery", () => {
	test("runs stale-only unlock and retries once after a lock failure", async () => {
		vi.spyOn(cleanupModule, "cleanupTemporaryKeys").mockImplementation(() => Promise.resolve());
		const safeExecMock = vi.spyOn(nodeModule, "safeExec").mockResolvedValue({
			exitCode: 0,
			stdout: "",
			stderr: "",
			timedOut: false,
		});
		const safeSpawnMock = vi
			.spyOn(nodeModule, "safeSpawn")
			.mockImplementationOnce(async ({ onStderr }) => {
				onStderr?.("unable to create lock in backend: repository is already locked");
				return {
					exitCode: 11,
					summary: "",
					error: "unable to create lock in backend: repository is already locked",
					stderr: "",
				};
			})
			.mockResolvedValueOnce({
				exitCode: 0,
				summary: backupSummary,
				error: "",
				stderr: "",
			});

		const restic = createRestic(mockDeps);
		const result = await Effect.runPromise(
			restic.backup(repositoryConfig, "/tmp/source", { organizationId: "org-1" }),
		);

		expect(result.exitCode).toBe(0);
		expect(safeSpawnMock).toHaveBeenCalledTimes(2);
		const unlockCalls = safeExecMock.mock.calls.filter(([params]) => params.args?.includes("unlock"));
		expect(unlockCalls).toHaveLength(1);
		expect(unlockCalls[0]?.[0].args).not.toContain("--remove-all");
	});

	test("propagates the retry error when the retry is still locked", async () => {
		vi.spyOn(cleanupModule, "cleanupTemporaryKeys").mockImplementation(() => Promise.resolve());
		const safeExecMock = vi.spyOn(nodeModule, "safeExec").mockResolvedValue({
			exitCode: 0,
			stdout: "",
			stderr: "",
			timedOut: false,
		});
		vi.spyOn(nodeModule, "safeSpawn").mockImplementation(async ({ onStderr }) => {
			onStderr?.("unable to create lock in backend: repository is already locked");
			return {
				exitCode: 11,
				summary: "",
				error: "unable to create lock in backend: repository is already locked",
				stderr: "",
			};
		});

		const restic = createRestic(mockDeps);

		await expect(
			Effect.runPromise(restic.backup(repositoryConfig, "/tmp/source", { organizationId: "org-1" })),
		).rejects.toThrow("unable to create lock in backend: repository is already locked");
		const unlockCalls = safeExecMock.mock.calls.filter(([params]) => params.args?.includes("unlock"));
		expect(unlockCalls).toHaveLength(1);
		expect(unlockCalls[0]?.[0].args).not.toContain("--remove-all");
	});

	test("runs stale-only unlock for both repositories before retrying copy", async () => {
		vi.spyOn(cleanupModule, "cleanupTemporaryKeys").mockImplementation(() => Promise.resolve());
		const abortController = new AbortController();
		let copyCalls = 0;
		const safeExecMock = vi.spyOn(nodeModule, "safeExec").mockImplementation(async ({ args }) => {
			if (args?.includes("copy")) {
				copyCalls += 1;
				return copyCalls === 1
					? {
							exitCode: 11,
							stdout: "",
							stderr: "unable to create lock in backend: repository is already locked",
							timedOut: false,
						}
					: {
							exitCode: 0,
							stdout: "copied",
							stderr: "",
							timedOut: false,
						};
			}

			return {
				exitCode: 0,
				stdout: "",
				stderr: "",
				timedOut: false,
			};
		});

		const restic = createRestic(mockDeps);
		await Effect.runPromise(
			restic.copy(sourceRepositoryConfig, destinationRepositoryConfig, {
				organizationId: "org-1",
				signal: abortController.signal,
			}),
		);

		const unlockCalls = safeExecMock.mock.calls.filter(([params]) => params.args?.includes("unlock"));
		expect(copyCalls).toBe(2);
		expect(unlockCalls).toHaveLength(2);
		for (const [params] of unlockCalls) {
			expect(params.args).not.toContain("--remove-all");
			expect(params.signal).toBe(abortController.signal);
		}
	});
});
