import * as fs from "node:fs/promises";
import * as os from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import * as nodeRuntime from "@zerobyte/core/node";
import { volumeService } from "../volume.service";
import { db } from "~/server/db/db";
import { createTestSession } from "~/test/helpers/auth";
import { withContext } from "~/server/core/request-context";
import { createTestVolume } from "~/test/helpers/volume";
import { VolumeHealthCheckJob } from "~/server/jobs/healthchecks";
import { VolumeAutoRemountJob } from "~/server/jobs/auto-remount";
import { findVolume } from "../volume-queries";
import { getVolumePath } from "../helpers";
import { BadRequestError } from "http-errors-enhanced";

vi.mock("node:fs/promises", async (original) => ({ ...(await original<typeof fs>()) }));
vi.mock("node:os", async (original) => ({ ...(await original<typeof os>()) }));
vi.mock("@zerobyte/core/node", async (original) => ({ ...(await original<typeof nodeRuntime>()) }));

afterEach(() => vi.restoreAllMocks());

test.each([true, false])("create returns the persisted mount result (directory: %s)", async (isDirectory) => {
	const { organizationId } = await createTestSession();
	const root = await fs.mkdtemp(join(os.tmpdir(), "zerobyte-created-volume-"));
	const file = join(root, "file.txt");

	try {
		await fs.writeFile(file, "not a directory");
		const { volume } = await withContext({ organizationId }, () =>
			volumeService.createVolume({
				sourceKind: "managed",
				name: "Created directory source",
				config: { backend: "directory", path: isDirectory ? root : file },
			}),
		);

		expect(volume.status).toBe(isDirectory ? "mounted" : "error");
		expect(volume.lastError).toBe(isDirectory ? null : "Path is not a directory");
		expect(await db.query.volumesTable.findFirst({ where: { id: volume.id } })).toEqual(volume);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test("managed config updates return mount failures and subsequent recovery", async () => {
	const { organizationId } = await createTestSession();
	const root = await fs.mkdtemp(join(os.tmpdir(), "zerobyte-updated-volume-"));
	const file = join(root, "file.txt");

	try {
		await fs.writeFile(file, "not a directory");
		const existing = await createTestVolume({ organizationId, config: { backend: "directory", path: root } });

		await withContext({ organizationId }, async () => {
			const { volume: failed } = await volumeService.updateVolume(existing.shortId, {
				config: { backend: "directory", path: file },
			});

			expect(failed.status).toBe("error");
			expect(failed.lastError).toBe("Path is not a directory");
			expect(await db.query.volumesTable.findFirst({ where: { id: existing.id } })).toEqual(failed);

			const { volume: recovered } = await volumeService.updateVolume(existing.shortId, {
				config: { backend: "directory", path: root },
			});

			expect(recovered.status).toBe("mounted");
			expect(recovered.lastError).toBeNull();
			expect(await db.query.volumesTable.findFirst({ where: { id: existing.id } })).toEqual(recovered);
		});
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test.each(["stored", "replacement"] as const)(
	"rejects an invalid %s managed config without changing the volume",
	async (source) => {
		const { organizationId } = await createTestSession();
		const invalidConfig = { backend: "directory", path: "" } as const;
		const volume = await createTestVolume({
			organizationId,
			config: source === "stored" ? invalidConfig : { backend: "directory", path: os.tmpdir() },
		});

		await withContext({ organizationId }, async () => {
			await expect(
				volumeService.updateVolume(volume.shortId, {
					name: "Should not persist",
					...(source === "replacement" ? { config: invalidConfig } : {}),
				}),
			).rejects.toThrow(new BadRequestError("Invalid volume configuration"));
		});

		expect(await db.query.volumesTable.findFirst({ where: { id: volume.id } })).toEqual(volume);
	},
);

test.each(["unmounted", "error", "mounted"] as const)(
	"controller recovers an accessible directory saved as %s without an agent",
	async (status) => {
		const { organizationId } = await createTestSession();
		const root = await fs.mkdtemp(join(os.tmpdir(), "zerobyte-controller-volume-"));

		try {
			const volume = await createTestVolume({
				organizationId,
				status,
				autoRemount: false,
				config: { backend: "directory", path: root },
			});
			await withContext({ organizationId }, async () => {
				const readiness = await volumeService.ensureHealthyVolume(volume);
				expect(readiness).toMatchObject({
					ready: true,
					remounted: false,
				});
				const detail = await volumeService.getVolume(volume.shortId);
				expect(detail.statfs).toEqual({});
				await fs.mkdir(join(root, "backups"));
				await fs.writeFile(join(root, "file.txt"), "backup data");

				await expect(volumeService.listFiles(volume.shortId)).rejects.toThrow("agent");
				await expect(volumeService.unmountVolume(volume.shortId)).resolves.toMatchObject({ status: "mounted" });
				await fs.rm(root, { recursive: true });
				await fs.writeFile(root, "not a directory");
				await expect(volumeService.ensureHealthyVolume(volume)).resolves.toMatchObject({
					ready: false,
					reason: "Path is not a directory",
				});
			});
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	},
);

test("periodic checks recover directories while preserving manually unmounted network volumes", async () => {
	const { organizationId } = await createTestSession();
	const root = await fs.mkdtemp(join(os.tmpdir(), "zerobyte-controller-health-"));

	try {
		const volume = await createTestVolume({
			organizationId,
			status: "unmounted",
			autoRemount: false,
			config: { backend: "directory", path: root },
		});
		const network = await createTestVolume({
			organizationId,
			status: "unmounted",
			type: "nfs",
			config: { backend: "nfs", server: "nas", exportPath: "/data", version: "4", port: 2049, readOnly: false },
		});
		await new VolumeHealthCheckJob().run();
		expect(await db.query.volumesTable.findFirst({ where: { id: volume.id } })).toMatchObject({
			status: "mounted",
		});
		await withContext({ organizationId }, () => volumeService.ensureHealthyVolume(network)).then((result) =>
			expect(result.ready).toBe(false),
		);
		await fs.rm(root, { recursive: true });
		await withContext({ organizationId }, () => volumeService.checkHealth(volume.shortId));
		await fs.mkdir(root);
		await new VolumeAutoRemountJob().run();
		expect(await db.query.volumesTable.findFirst({ where: { id: volume.id } })).toMatchObject({
			status: "mounted",
			autoRemount: false,
		});
		expect(await db.query.volumesTable.findFirst({ where: { id: network.id } })).toMatchObject({
			status: "unmounted",
		});
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test("controller mounts, checks and unmounts managed backends without a connected local agent", async () => {
	const { organizationId } = await createTestSession();
	const volume = await createTestVolume({
		organizationId,
		status: "error",
		type: "nfs",
		config: { backend: "nfs", server: "nas", exportPath: "/data", version: "4", port: 2049, readOnly: false },
	});
	const mountPath = getVolumePath(volume);
	let mounted = false;
	const originalReadFile = fs.readFile;
	vi.spyOn(os, "platform").mockReturnValue("linux");
	vi.spyOn(fs, "readFile").mockImplementation((...args) =>
		args[0] === "/proc/self/mountinfo"
			? Promise.resolve(mounted ? `36 25 0:32 / ${mountPath} rw - nfs nas:/data rw` : "")
			: originalReadFile(...args),
	);
	vi.spyOn(fs, "access").mockResolvedValue();
	vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);
	vi.spyOn(fs, "rmdir").mockResolvedValue();
	const execute = vi.spyOn(nodeRuntime, "safeExec").mockImplementation(async ({ command }) => {
		mounted = command === "mount";
		return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
	});

	await withContext({ organizationId }, async () => {
		await expect(volumeService.ensureHealthyVolume(volume)).resolves.toMatchObject({
			ready: true,
			remounted: true,
		});
		await expect(volumeService.checkHealth(volume.shortId)).resolves.toMatchObject({ status: "mounted" });
		await expect(volumeService.unmountVolume(volume.shortId)).resolves.toMatchObject({ status: "unmounted" });
		const unmountedVolume = await findVolume(volume.shortId);
		if (!unmountedVolume) throw new Error("Unmounted volume not found");

		expect(unmountedVolume.status).toBe("unmounted");
		await expect(volumeService.ensureHealthyVolume(unmountedVolume)).resolves.toMatchObject({ ready: false });
	});

	expect(execute.mock.calls.map(([request]) => request.command)).toEqual(["mount", "umount"]);
	expect(await db.query.volumesTable.findFirst({ where: { id: volume.id } })).toMatchObject({
		status: "unmounted",
		lastError: null,
	});
});

test("controller tests backend connections without a worker", async () => {
	const root = await fs.mkdtemp(join(os.tmpdir(), "zerobyte-controller-connection-"));

	try {
		await expect(volumeService.testConnection({ backend: "directory", path: root })).resolves.toMatchObject({
			success: true,
		});
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});
