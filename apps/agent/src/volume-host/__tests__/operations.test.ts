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

test("listVolumeFiles rejects traversal outside the volume", async () => {
	const volume = await createDirectoryVolume();

	await expect(listVolumeFiles(volume, "../outside", 0, 10)).rejects.toThrow("Invalid path");
});

test("listVolumeFiles reports missing directories consistently", async () => {
	const volume = await createDirectoryVolume();

	await expect(listVolumeFiles(volume, "/missing", 0, 10)).rejects.toThrow("Directory not found");
});
