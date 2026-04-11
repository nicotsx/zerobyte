import { afterEach, describe, expect, test, vi } from "vitest";
import * as cleanupModule from "../../helpers/cleanup-temporary-keys";
import * as spawnModule from "../../../utils/spawn";
import { ResticError } from "../../error";
import { restore } from "../restore";
import type { ResticDeps } from "../../types";
import type { SafeSpawnParams, SpawnResult } from "../../../utils/spawn";

const mockDeps: ResticDeps = {
	resolveSecret: async (s) => s,
	getOrganizationResticPassword: async () => "org-restic-password",
	resticCacheDir: "/tmp/restic-cache",
	resticPassFile: "/tmp/restic.pass",
	defaultExcludes: ["/tmp/restic.pass", "/var/lib/zerobyte/repositories"],
	rcloneConfigFile: "/root/.config/rclone/rclone.conf",
};

const successfulRestoreSummary = JSON.stringify({
	message_type: "summary",
	total_files: 2,
	files_restored: 1,
	files_skipped: 1,
	bytes_skipped: 0,
});

const validProgressLine = JSON.stringify({
	message_type: "status",
	seconds_elapsed: 5,
	percent_done: 0.5,
	total_files: 2,
	files_restored: 1,
	total_bytes: 1024,
	bytes_restored: 512,
});

const config = {
	backend: "local" as const,
	path: "/tmp/restic-repo",
	isExistingRepository: true,
	customPassword: "custom-password",
};

type SetupOptions = {
	spawnResult?: Partial<SpawnResult>;
	onSpawnCall?: (params: SafeSpawnParams) => void | Promise<void>;
};

const setup = ({ spawnResult = {}, onSpawnCall }: SetupOptions = {}) => {
	let capturedArgs: string[] = [];

	vi.spyOn(cleanupModule, "cleanupTemporaryKeys").mockImplementation(() => Promise.resolve());
	vi.spyOn(spawnModule, "safeSpawn").mockImplementation((params: SafeSpawnParams) => {
		capturedArgs = params.args;
		return Promise.resolve(onSpawnCall?.(params)).then(() => ({
			exitCode: 0,
			summary: successfulRestoreSummary,
			error: "",
			...spawnResult,
		}));
	});

	const getRestoreArg = () => {
		const separatorIndex = capturedArgs.indexOf("--");
		if (separatorIndex < 0 || !capturedArgs[separatorIndex + 1]) {
			throw new Error("Expected restore argument after separator");
		}
		return capturedArgs[separatorIndex + 1]!;
	};

	const getOptionValues = (option: string) => {
		const values: string[] = [];
		for (let i = 0; i < capturedArgs.length - 1; i++) {
			if (capturedArgs[i] === option && capturedArgs[i + 1]) {
				values.push(capturedArgs[i + 1]!);
			}
		}
		return values;
	};

	return {
		getArgs: () => capturedArgs,
		getRestoreArg,
		getOptionValues,
	};
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("restore command", () => {
	describe("path selection", () => {
		test("uses the common ancestor as restore root and strips includes for non-root targets", async () => {
			const { getRestoreArg, getOptionValues } = setup();

			await restore(
				config,
				"snapshot-456",
				"/tmp/restore-target",
				{
					organizationId: "org-1",
					include: [
						"/var/lib/zerobyte/volumes/vol123/_data/Documents/report.pdf",
						"/var/lib/zerobyte/volumes/vol123/_data/Photos/summer.jpg",
					],
				},
				mockDeps,
			);

			expect(getRestoreArg()).toBe("snapshot-456:/var/lib/zerobyte/volumes/vol123/_data");
			expect(getOptionValues("--include")).toEqual(["Documents/report.pdf", "Photos/summer.jpg"]);
		});

		test("restores a selected file from its parent directory for non-root targets", async () => {
			const { getRestoreArg, getOptionValues } = setup();

			await restore(
				config,
				"snapshot-single-file",
				"/tmp/restore-target",
				{
					organizationId: "org-1",
					include: ["/var/lib/zerobyte/volumes/vol123/_data/archive/backup.20260301-233001.7z"],
					selectedItemKind: "file",
				},
				mockDeps,
			);

			expect(getRestoreArg()).toBe("snapshot-single-file:/var/lib/zerobyte/volumes/vol123/_data/archive");
			expect(getOptionValues("--include")).toEqual(["backup.20260301-233001.7z"]);
		});

		test("treats flag-like snapshot IDs as positional restore args", async () => {
			const { getArgs, getRestoreArg } = setup();

			await restore(
				config,
				"--help",
				"/tmp/restore-target",
				{
					organizationId: "org-1",
					basePath: "/var/lib/zerobyte/volumes/vol123/_data",
				},
				mockDeps,
			);

			const separatorIndex = getArgs().indexOf("--");
			expect(separatorIndex).toBeGreaterThan(-1);
			expect(getRestoreArg()).toBe("--help:/var/lib/zerobyte/volumes/vol123/_data");
		});
	});

	describe("output handling", () => {
		test("returns a parsed restore summary on success", async () => {
			setup();

			const result = await restore(
				config,
				"snapshot-123",
				"/tmp/restore-target",
				{ organizationId: "org-1", basePath: "/var/lib/zerobyte/volumes/vol123/_data" },
				mockDeps,
			);

			expect(result).toMatchObject({
				message_type: "summary",
				files_restored: 1,
				files_skipped: 1,
			});
		});

		test("throws ResticError when the command fails", async () => {
			setup({ spawnResult: { exitCode: 1, summary: "", error: "restore failed" } });

			await expect(
				restore(
					config,
					"snapshot-123",
					"/tmp/restore-target",
					{ organizationId: "org-1", basePath: "/var/lib/zerobyte/volumes/vol123/_data" },
					mockDeps,
				),
			).rejects.toBeInstanceOf(ResticError);
		});

		test("falls back to an empty summary when restic output cannot be parsed", async () => {
			setup({ spawnResult: { summary: "not-json" } });

			const result = await restore(
				config,
				"snapshot-123",
				"/tmp/restore-target",
				{ organizationId: "org-1", basePath: "/var/lib/zerobyte/volumes/vol123/_data" },
				mockDeps,
			);

			expect(result).toEqual({
				message_type: "summary",
				total_files: 0,
				files_restored: 0,
				files_skipped: 0,
				bytes_skipped: 0,
			});
		});
	});

	describe("progress callbacks", () => {
		test("calls onProgress with parsed status updates", async () => {
			const progressUpdates: unknown[] = [];
			setup({ onSpawnCall: (params) => params.onStdout?.(validProgressLine) });

			await restore(
				config,
				"snapshot-123",
				"/tmp/restore-target",
				{
					organizationId: "org-1",
					basePath: "/var/lib/zerobyte/volumes/vol123/_data",
					onProgress: (progress) => progressUpdates.push(progress),
				},
				mockDeps,
			);

			expect(progressUpdates).toHaveLength(1);
			expect(progressUpdates[0]).toMatchObject({
				message_type: "status",
				percent_done: 0.5,
				files_restored: 1,
			});
		});

		test("ignores non-JSON progress lines", async () => {
			const progressUpdates: unknown[] = [];
			setup({
				onSpawnCall: (params) => {
					params.onStdout?.("scanning...");
					params.onStdout?.("repository opened");
				},
			});

			await restore(
				config,
				"snapshot-123",
				"/tmp/restore-target",
				{
					organizationId: "org-1",
					basePath: "/var/lib/zerobyte/volumes/vol123/_data",
					onProgress: (progress) => progressUpdates.push(progress),
				},
				mockDeps,
			);

			expect(progressUpdates).toHaveLength(0);
		});
	});
});
