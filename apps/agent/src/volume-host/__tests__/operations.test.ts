import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Volume as AgentVolume } from "@zerobyte/contracts/volumes";
import { afterEach, expect, test, vi } from "vitest";
import { logger } from "@zerobyte/core/node";
import { fromPartial } from "@total-typescript/shoehorn";
import { listVolumeFiles } from "../operations";
import { createAgentExecutionPolicy, type ResolvedFileListingSource } from "../../execution-policy";
import { createTrustedRootRegistry } from "../../trusted-roots";
import { createTrustedSourcePresentation, serializeFilesystemPath } from "../../trusted-source-presentation";

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

const createDirectoryVolume = async (): Promise<Extract<AgentVolume, { sourceKind: "managed" }>> => {
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
		sourceKind: "managed",
		trustedRootId: null,
		relativePath: null,
	};
};

const resolveManagedVolume = async (
	subPath?: string,
	volume?: Extract<AgentVolume, { sourceKind: "managed" }>,
): Promise<ResolvedFileListingSource> => {
	const resolvedVolume = volume ?? (await createDirectoryVolume());
	const registry = createTrustedRootRegistry({ builtinLocal: true });
	const executionPolicy = createAgentExecutionPolicy({ builtinLocal: true, registry });
	return executionPolicy.resolveFileListingSource({ kind: "managed", volume: resolvedVolume }, subPath);
};

test("listVolumeFiles returns sorted paginated entries inside the volume", async () => {
	const volume = await resolveManagedVolume();
	await fs.mkdir(path.join(tempRoot!, "z-dir"));
	await fs.mkdir(path.join(tempRoot!, "a-dir"));
	await fs.writeFile(path.join(tempRoot!, "b-file.txt"), "hello");

	const result = await listVolumeFiles(volume, 1, 2);

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
	const volume = await resolveManagedVolume("../outside");

	await expect(listVolumeFiles(volume, 0, 10)).rejects.toThrow("Invalid path");
});

test("listVolumeFiles reports missing directories consistently", async () => {
	const volume = await resolveManagedVolume("missing");
	const logError = vi.spyOn(logger, "error").mockImplementation(() => {});

	await expect(listVolumeFiles(volume, 0, 10)).rejects.toThrow("Directory not found");
	expect(logError).toHaveBeenCalledWith("Failed to list volume directory", {
		volumeId: volume.sourceId,
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

	const folders = await listVolumeFiles(await resolveManagedVolume("/Default/AppData", volume));
	expect(folders.files).toEqual([
		expect.objectContaining({ name: "Local", path: "/Default/AppData/Local", type: "directory" }),
	]);
	const files = await listVolumeFiles(await resolveManagedVolume(folders.files[0]!.path, volume));
	expect(files.files).toEqual([
		expect.objectContaining({ name: "example.txt", path: "/Default/AppData/Local/example.txt", type: "file" }),
	]);
});

test("listVolumeFiles restores the separator when Windows realpath returns a bare drive", async () => {
	const volume = await resolveManagedVolume();
	volume.canonicalPath = "C:\\";
	volume.containmentRootPath = "C:\\";
	vi.stubGlobal("process", { ...process, platform: "win32" });
	const resolve = vi.spyOn(fs, "realpath").mockResolvedValue("C:");
	const read = vi.spyOn(fs, "readdir").mockResolvedValue([]);

	const result = await listVolumeFiles(volume);
	expect(resolve).toHaveBeenCalledWith("C:\\");
	expect(read).toHaveBeenCalledWith("C:\\", { withFileTypes: true });
	expect(result.files).toEqual([]);
});

test("trusted nested listings stay relative to the selected source", async () => {
	tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-volume-ops-trusted-"));
	await fs.mkdir(path.join(tempRoot, "configured", "dir", "child"), { recursive: true });
	await fs.writeFile(path.join(tempRoot, "configured", "dir", "child", "file.txt"), "hello");
	const rawRoots = JSON.stringify([{ id: "data", label: "Data", path: tempRoot }]);
	const registry = createTrustedRootRegistry({ rawRoots });
	const sourceReference = {
		kind: "agent-filesystem" as const,
		reference: { rootId: "data", relativePath: "configured" },
	};
	const executionPolicy = createAgentExecutionPolicy({ builtinLocal: false, registry });
	const firstSource = executionPolicy.resolveFileListingSource(sourceReference, "/dir");
	const secondSource = executionPolicy.resolveFileListingSource(sourceReference, "/dir/child");

	const firstLevel = await listVolumeFiles(firstSource, 0, 10);
	const secondLevel = await listVolumeFiles(secondSource, 0, 10);

	expect(firstLevel.path).toBe("/dir");
	expect(firstLevel.files[0]?.path).toBe("/dir/child");
	expect(secondLevel.path).toBe("/dir/child");
	expect(secondLevel.files[0]?.path).toBe("/dir/child/file.txt");
	expect(() => executionPolicy.resolveFileListingSource(sourceReference, "/../outside")).toThrow();
});

test("structured progress is relative and arbitrary errors stay agent-local", () => {
	const presentation = createTrustedSourcePresentation({
		configuredRootPath: "/srv/data",
		canonicalRootPath: "/srv/data",
		sourceRelativePath: "photos",
	});
	const progress = fromPartial<Parameters<typeof presentation.formatProgress>[0]>({
		current_files: ["/srv/data/photos/image.jpg", "/private/outside.txt"],
	});
	expect(presentation.formatProgress(progress).current_files).toEqual(["/photos/image.jpg", "[outside source]"]);
	const safeError = presentation.formatError(new Error("failed file:///srv/data/private?path=/private/file"));
	expect(safeError).not.toContain("/srv/data");
	expect(safeError).not.toContain("/private");
	expect(presentation.sourcePath).toBe("/photos");
	expect(serializeFilesystemPath(String.raw`dir\file`)).toBe("dir/file");
});
