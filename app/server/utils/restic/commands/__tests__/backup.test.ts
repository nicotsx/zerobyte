import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as cleanupModule from "~/server/utils/restic/helpers/cleanup-temporary-keys";
import * as spawnModule from "~/server/utils/spawn";
import { ResticError } from "~/server/utils/errors";
import { backup } from "../backup";

const VALID_SUMMARY = JSON.stringify({
	message_type: "summary",
	files_new: 10,
	files_changed: 5,
	files_unmodified: 85,
	dirs_new: 2,
	dirs_changed: 1,
	dirs_unmodified: 17,
	data_blobs: 20,
	tree_blobs: 5,
	data_added: 1048576,
	total_files_processed: 100,
	total_bytes_processed: 2097152,
	total_duration: 12.34,
	snapshot_id: "abcd1234",
});

const VALID_PROGRESS_LINE = JSON.stringify({
	message_type: "status",
	seconds_elapsed: 5,
	percent_done: 0.5,
	total_files: 100,
	files_done: 50,
	total_bytes: 2097152,
	bytes_done: 1048576,
});

const config = {
	backend: "local" as const,
	path: "/tmp/restic-repo",
	isExistingRepository: true,
	customPassword: "custom-password",
};

type SetupOptions = {
	spawnResult?: Partial<spawnModule.SpawnResult>;
	onSpawnCall?: (params: spawnModule.SafeSpawnParams) => void;
};

/**
 * Sets up mocks for safeSpawn and cleanupTemporaryKeys, captures spawn args,
 * and returns helpers to inspect what was passed to restic.
 */
const setup = ({ spawnResult = {}, onSpawnCall }: SetupOptions = {}) => {
	let capturedArgs: string[] = [];

	const cleanupSpy = spyOn(cleanupModule, "cleanupTemporaryKeys").mockImplementation(() => Promise.resolve());
	spyOn(spawnModule, "safeSpawn").mockImplementation((params) => {
		capturedArgs = params.args;
		onSpawnCall?.(params);
		return Promise.resolve({ exitCode: 0, summary: VALID_SUMMARY, error: "", ...spawnResult });
	});

	return {
		cleanupSpy,
		getArgs: () => capturedArgs,
		hasFlag: (flag: string) => capturedArgs.includes(flag),
		getOptionValues: (option: string): string[] => {
			const values: string[] = [];
			for (let i = 0; i < capturedArgs.length - 1; i++) {
				if (capturedArgs[i] === option && capturedArgs[i + 1]) {
					values.push(capturedArgs[i + 1]!);
				}
			}
			return values;
		},
	};
};

afterEach(() => {
	mock.restore();
});

describe("backup command", () => {
	describe("argument construction", () => {
		test("passes source path as positional arg when no include list is given", async () => {
			const { getArgs, hasFlag } = setup();
			await backup(config, "/mnt/data", { organizationId: "org-1" });

			expect(getArgs()).toContain("/mnt/data");
			expect(hasFlag("--files-from")).toBe(false);
		});

		test("uses --files-from instead of source path when include list is provided", async () => {
			const { hasFlag, getArgs } = setup();
			await backup(config, "/mnt/data", {
				organizationId: "org-1",
				include: ["/mnt/data/docs", "/mnt/data/photos"],
			});

			expect(hasFlag("--files-from")).toBe(true);
			expect(getArgs()).not.toContain("/mnt/data");
		});

		test("adds --tag for each entry in options.tags", async () => {
			const { getOptionValues } = setup();
			await backup(config, "/mnt/data", {
				organizationId: "org-1",
				tags: ["tag-a", "tag-b"],
			});

			expect(getOptionValues("--tag")).toEqual(["tag-a", "tag-b"]);
		});

		test("omits --tag when tags list is empty", async () => {
			const { hasFlag } = setup();
			await backup(config, "/mnt/data", { organizationId: "org-1", tags: [] });

			expect(hasFlag("--tag")).toBe(false);
		});

		test("passes provided compressionMode to --compression", async () => {
			const { getOptionValues } = setup();
			await backup(config, "/mnt/data", { organizationId: "org-1", compressionMode: "max" });

			expect(getOptionValues("--compression")).toEqual(["max"]);
		});

		test("defaults --compression to auto when compressionMode is omitted", async () => {
			const { getOptionValues } = setup();
			await backup(config, "/mnt/data", { organizationId: "org-1" });

			expect(getOptionValues("--compression")).toEqual(["auto"]);
		});

		test("adds --one-file-system when oneFileSystem is true", async () => {
			const { hasFlag } = setup();
			await backup(config, "/mnt/data", { organizationId: "org-1", oneFileSystem: true });

			expect(hasFlag("--one-file-system")).toBe(true);
		});

		test("omits --one-file-system when oneFileSystem is false", async () => {
			const { hasFlag } = setup();
			await backup(config, "/mnt/data", { organizationId: "org-1", oneFileSystem: false });

			expect(hasFlag("--one-file-system")).toBe(false);
		});

		test("adds --exclude-file when exclude list is provided", async () => {
			const { hasFlag } = setup();
			await backup(config, "/mnt/data", {
				organizationId: "org-1",
				exclude: ["/mnt/data/tmp", "/mnt/data/cache"],
			});

			expect(hasFlag("--exclude-file")).toBe(true);
		});

		test("omits --exclude-file when exclude list is empty", async () => {
			const { hasFlag } = setup();
			await backup(config, "/mnt/data", { organizationId: "org-1", exclude: [] });

			expect(hasFlag("--exclude-file")).toBe(false);
		});

		test("adds --exclude-if-present for each entry in excludeIfPresent", async () => {
			const { getOptionValues } = setup();
			await backup(config, "/mnt/data", {
				organizationId: "org-1",
				excludeIfPresent: [".nobackup", ".gitignore"],
			});

			expect(getOptionValues("--exclude-if-present")).toEqual([".nobackup", ".gitignore"]);
		});

		test("always includes DEFAULT_EXCLUDES as --exclude args", async () => {
			const { getOptionValues } = setup();
			await backup(config, "/mnt/data", { organizationId: "org-1" });

			expect(getOptionValues("--exclude").length).toBeGreaterThan(0);
		});

		test("includes --host arg from config", async () => {
			const { hasFlag } = setup();
			await backup(config, "/mnt/data", { organizationId: "org-1" });

			expect(hasFlag("--host")).toBe(true);
		});
	});

	describe("exit code handling", () => {
		test("returns parsed result on exit code 0", async () => {
			setup();
			const { result, exitCode } = await backup(config, "/mnt/data", { organizationId: "org-1" });

			expect(exitCode).toBe(0);
			expect(result?.snapshot_id).toBe("abcd1234");
		});

		test("returns result without throwing on exit code 3 (partial read errors)", async () => {
			setup({ spawnResult: { exitCode: 3 } });
			const { result, exitCode } = await backup(config, "/mnt/data", { organizationId: "org-1" });

			expect(exitCode).toBe(3);
			expect(result).not.toBeNull();
		});

		test("throws ResticError on non-zero, non-3 exit codes", async () => {
			setup({ spawnResult: { exitCode: 1, summary: "", error: "fatal error" } });

			await expect(backup(config, "/mnt/data", { organizationId: "org-1" })).rejects.toBeInstanceOf(ResticError);
		});

		test("preserves the exit code inside the thrown ResticError", async () => {
			setup({ spawnResult: { exitCode: 12, summary: "", error: "wrong password" } });

			const error = await backup(config, "/mnt/data", { organizationId: "org-1" }).catch((e) => e);
			expect(error).toBeInstanceOf(ResticError);
			expect((error as ResticError).code).toBe(12);
		});

		test("returns { result: null } when the abort signal is triggered", async () => {
			const controller = new AbortController();
			setup({
				onSpawnCall: () => controller.abort(),
				spawnResult: { exitCode: 130, summary: "", error: "" },
			});

			const { result, exitCode } = await backup(config, "/mnt/data", {
				organizationId: "org-1",
				signal: controller.signal,
			});

			expect(result).toBeNull();
			expect(exitCode).toBe(130);
		});
	});

	describe("output parsing", () => {
		test("returns a fully parsed summary object on valid output", async () => {
			setup();
			const { result } = await backup(config, "/mnt/data", { organizationId: "org-1" });

			expect(result).toMatchObject({
				message_type: "summary",
				snapshot_id: "abcd1234",
				total_duration: 12.34,
			});
		});

		test("returns { result: null } when summary line is not valid JSON", async () => {
			setup({ spawnResult: { summary: "not-json" } });
			const { result } = await backup(config, "/mnt/data", { organizationId: "org-1" });

			expect(result).toBeNull();
		});

		test("returns { result: null } when summary JSON does not satisfy the schema", async () => {
			setup({ spawnResult: { summary: JSON.stringify({ message_type: "summary" }) } });
			const { result } = await backup(config, "/mnt/data", { organizationId: "org-1" });

			expect(result).toBeNull();
		});
	});

	describe("progress callbacks", () => {
		test("calls onProgress with parsed data when a valid status line arrives", async () => {
			const progressUpdates: unknown[] = [];
			setup({ onSpawnCall: (params) => params.onStdout?.(VALID_PROGRESS_LINE) });

			await backup(config, "/mnt/data", {
				organizationId: "org-1",
				onProgress: (p) => progressUpdates.push(p),
			});

			expect(progressUpdates.length).toBeGreaterThan(0);
			expect(progressUpdates[0]).toMatchObject({
				message_type: "status",
				percent_done: 0.5,
				files_done: 50,
			});
		});

		test("ignores non-JSON stdout lines without throwing", async () => {
			setup({
				onSpawnCall: (params) => {
					params.onStdout?.("scanning...");
					params.onStdout?.("repository opened");
				},
			});

			await expect(
				backup(config, "/mnt/data", { organizationId: "org-1", onProgress: () => {} }),
			).resolves.toBeDefined();
		});

		test("ignores valid JSON lines that do not match the progress schema", async () => {
			const progressUpdates: unknown[] = [];
			setup({
				onSpawnCall: (params) => params.onStdout?.(JSON.stringify({ message_type: "verbose_status", action: "scan" })),
			});

			await backup(config, "/mnt/data", {
				organizationId: "org-1",
				onProgress: (p) => progressUpdates.push(p),
			});

			expect(progressUpdates).toHaveLength(0);
		});
	});

	describe("cleanup", () => {
		test("calls cleanupTemporaryKeys after a successful backup", async () => {
			const { cleanupSpy } = setup();
			await backup(config, "/mnt/data", { organizationId: "org-1" });

			expect(cleanupSpy).toHaveBeenCalledTimes(1);
		});

		test("calls cleanupTemporaryKeys even when the command fails", async () => {
			const { cleanupSpy } = setup({ spawnResult: { exitCode: 1, summary: "", error: "fail" } });
			await backup(config, "/mnt/data", { organizationId: "org-1" }).catch(() => {});

			expect(cleanupSpy).toHaveBeenCalledTimes(1);
		});
	});
});
