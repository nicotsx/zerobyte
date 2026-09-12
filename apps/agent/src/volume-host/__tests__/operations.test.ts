import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Volume as AgentVolume } from "@zerobyte/contracts/volumes";
import { afterEach, expect, test, vi } from "vitest";
import { logger } from "@zerobyte/core/node";
import { listVolumeFiles } from "../operations";

vi.mock("node:fs/promises", async (importOriginal) => ({
	...(await importOriginal<typeof fs>()),
}));

let tempRoot: string | undefined;

afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	if (tempRoot) {
		await fs.rm(tempRoot, { recursive: true, force: true });
		tempRoot = undefined;
	}
});

const createDirectoryVolume = async (): Promise<AgentVolume> => {
	tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-volume-ops-"));
	return {
		id: 1,
		shortId: "volume-1",
		name: "Test volume",
		config: { backend: "directory", path: tempRoot },
		createdAt: Date.now(),
		updatedAt: Date.now(),
		lastHealthCheck: Date.now(),
		type: "directory",
		status: "mounted",
		lastError: null,
		provisioningId: null,
		autoRemount: true,
		agentId: "local",
		organizationId: "org-1",
	};
};

test("listVolumeFiles returns sorted paginated entries inside the volume", async () => {
	const volume = await createDirectoryVolume();
	await fs.mkdir(path.join(tempRoot!, "z-dir"));
	await fs.mkdir(path.join(tempRoot!, "a-dir"));
	await fs.writeFile(path.join(tempRoot!, "b-file.txt"), "hello");

	const result = await listVolumeFiles(volume, undefined, 1, 2);

	expect(result).toMatchObject({
		path: "/",
		offset: 1,
		limit: 2,
		total: 3,
		hasMore: false,
	});
	expect(result.files.map((entry) => entry.name)).toEqual(["z-dir", "b-file.txt"]);
	expect(result.files[1]).toMatchObject({ path: "/b-file.txt", type: "file", size: 5 });
});

test("listVolumeFiles rejects traversal outside the volume", async () => {
	const volume = await createDirectoryVolume();

	await expect(listVolumeFiles(volume, "../outside", 0, 10)).rejects.toThrow("Invalid path");
});

test("listVolumeFiles reports missing directories consistently", async () => {
	const volume = await createDirectoryVolume();
	const logError = vi.spyOn(logger, "error").mockImplementation(() => {});

	await expect(listVolumeFiles(volume, "missing", 0, 10)).rejects.toThrow("Directory not found");
	expect(logError).toHaveBeenCalledWith("Failed to list volume directory", {
		volumeId: volume.shortId,
		volumePath: tempRoot,
		requestedPath: path.join(tempRoot!, "missing"),
		error: expect.stringContaining("ENOENT"),
		code: "ENOENT",
	});
});

test("listVolumeFiles returns slash-separated paths when expanding nested folders", async () => {
	const volume = await createDirectoryVolume();
	await fs.mkdir(path.join(tempRoot!, "Default", "AppData", "Local"), { recursive: true });
	await fs.writeFile(path.join(tempRoot!, "Default", "AppData", "Local", "example.txt"), "hello");

	const folders = await listVolumeFiles(volume, "/Default/AppData");
	expect(folders.files).toEqual([
		expect.objectContaining({ name: "Local", path: "/Default/AppData/Local", type: "directory" }),
	]);
	const files = await listVolumeFiles(volume, folders.files[0]!.path);
	expect(files.files).toEqual([
		expect.objectContaining({ name: "example.txt", path: "/Default/AppData/Local/example.txt", type: "file" }),
	]);
});

test("listVolumeFiles restores the separator when Windows realpath returns a bare drive", async () => {
	const volume = await createDirectoryVolume();
	volume.config = { backend: "directory", path: "C:\\" };
	vi.stubGlobal("process", { ...process, platform: "win32" });
	const resolve = vi.spyOn(fs, "realpath").mockResolvedValue("C:");
	const read = vi.spyOn(fs, "readdir").mockResolvedValue([]);

	const result = await listVolumeFiles(volume);
	expect(resolve).toHaveBeenCalledWith("C:\\");
	expect(read).toHaveBeenCalledWith("C:\\", { withFileTypes: true });
	expect(result.files).toEqual([]);
});
