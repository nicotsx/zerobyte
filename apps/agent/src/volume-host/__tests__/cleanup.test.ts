import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, expect, test, vi } from "vitest";

let tempRoot: string | undefined;
let mockMountPoints: string[] = [];
let mockMountInfoError: Error | undefined;

afterEach(async () => {
	vi.doUnmock("../constants");
	vi.doUnmock("../fs");
	vi.resetModules();
	mockMountPoints = [];
	mockMountInfoError = undefined;
	if (tempRoot) {
		await fs.rm(tempRoot, { recursive: true, force: true });
		tempRoot = undefined;
	}
});

const loadCleanup = async () => {
	vi.resetModules();
	tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-agent-cleanup-"));
	vi.doMock("../constants", () => ({ VOLUME_MOUNT_BASE: tempRoot }));
	vi.doMock("../fs", () => ({
		readMountInfo: async () => {
			if (mockMountInfoError) {
				throw mockMountInfoError;
			}

			return mockMountPoints.map((mountPoint) => ({ mountPoint, fstype: "fuse.sshfs" }));
		},
	}));

	return import("../cleanup");
};

test("removes stale volume directories that are not mounted on the agent host", async () => {
	const { cleanupDanglingVolumeMountDirectories } = await loadCleanup();
	await fs.mkdir(path.join(tempRoot!, "stale-volume", "_data"), { recursive: true });

	await cleanupDanglingVolumeMountDirectories();

	await expect(fs.access(path.join(tempRoot!, "stale-volume"))).rejects.toThrow();
});

test("keeps volume directories that are still mounted on the agent host", async () => {
	const { cleanupDanglingVolumeMountDirectories } = await loadCleanup();
	const localVolumeDir = path.join(tempRoot!, "mounted-volume");
	mockMountPoints = [path.join(localVolumeDir, "_data")];
	await fs.mkdir(path.join(localVolumeDir, "_data"), { recursive: true });

	await cleanupDanglingVolumeMountDirectories();

	await expect(fs.access(localVolumeDir)).resolves.toBeNull();
});

test.each([
	["mount discovery", new Error("mount command failed")],
	["mount parser", new Error("Failed to parse non-empty mount command output")],
])("removes nothing when %s fails", async (_failureType, error) => {
	const { cleanupDanglingVolumeMountDirectories } = await loadCleanup();
	const volumeDir = path.join(tempRoot!, "preserved-volume");
	mockMountInfoError = error;
	await fs.mkdir(path.join(volumeDir, "_data"), { recursive: true });

	await expect(cleanupDanglingVolumeMountDirectories()).rejects.toThrow(error.message);

	await expect(fs.access(volumeDir)).resolves.toBeNull();
});
