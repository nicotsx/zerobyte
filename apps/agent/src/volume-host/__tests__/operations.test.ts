import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Volume as AgentVolume } from "@zerobyte/contracts/volumes";
import { afterEach, expect, test } from "vitest";
import { listVolumeFiles } from "../operations";

let tempRoot: string | undefined;

afterEach(async () => {
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

test("listVolumeFiles treats an empty string as the volume root", async () => {
	const volume = await createDirectoryVolume();
	await fs.mkdir(path.join(tempRoot!, "logs"));

	const result = await listVolumeFiles(volume, "", 0, 10);

	expect(result.path).toBe("/");
	expect(result.files[0]).toMatchObject({ name: "logs", path: "/logs", type: "directory" });
});

test("listVolumeFiles preserves literal POSIX path segment characters", async () => {
	const volume = await createDirectoryVolume();
	await fs.mkdir(path.join(tempRoot!, "movies [1]"));
	await fs.writeFile(path.join(tempRoot!, "movies [1]", "clip one.txt"), "hello");
	await fs.mkdir(path.join(tempRoot!, "foo\\bar"));
	await fs.writeFile(path.join(tempRoot!, "foo\\bar", "nested.txt"), "hello");
	await fs.mkdir(path.join(tempRoot!, "foo%2Fbar"));

	const result = await listVolumeFiles(volume, undefined, 0, 10);

	expect(result.files).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ name: "movies [1]", path: "/movies%20%5B1%5D" }),
			expect.objectContaining({ name: "foo\\bar", path: "/foo%5Cbar" }),
			expect.objectContaining({ name: "foo%2Fbar", path: "/foo%252Fbar" }),
		]),
	);

	const spacedNested = await listVolumeFiles(volume, "/movies%20%5B1%5D", 0, 10);

	expect(spacedNested.path).toBe("/movies%20%5B1%5D");
	expect(spacedNested.files[0]).toMatchObject({
		name: "clip one.txt",
		path: "/movies%20%5B1%5D/clip%20one.txt",
	});

	const nested = await listVolumeFiles(volume, "/foo%5Cbar", 0, 10);

	expect(nested.path).toBe("/foo%5Cbar");
	expect(nested.files[0]).toMatchObject({ name: "nested.txt", path: "/foo%5Cbar/nested.txt" });
});

test("listVolumeFiles rejects traversal outside the volume", async () => {
	const volume = await createDirectoryVolume();

	await expect(listVolumeFiles(volume, "../outside", 0, 10)).rejects.toThrow("Invalid path");
});

test("listVolumeFiles reports missing directories consistently", async () => {
	const volume = await createDirectoryVolume();

	await expect(listVolumeFiles(volume, "/missing", 0, 10)).rejects.toThrow("Directory not found");
});
