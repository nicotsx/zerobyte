import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VolumeHealthCheckJob } from "~/server/jobs/healthchecks";
import { VolumeAutoRemountJob } from "~/server/jobs/auto-remount";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { presentedVolumeSchema } from "@zerobyte/contracts/volumes";
import { logger } from "@zerobyte/core/node";
const agentManagerMock = vi.hoisted(() => ({
	isAgentReady: vi.fn(),
	runVolumeCommand: vi.fn(),
}));

vi.mock("../../agents/agents-manager", () => ({
	agentManager: agentManagerMock,
}));

import { volumeService } from "../volume.service";
import { db } from "~/server/db/db";
import { volumesTable } from "~/server/db/schema";
import { randomUUID } from "node:crypto";
import { createTestSession } from "~/test/helpers/auth";
import { withContext } from "~/server/core/request-context";
import { asShortId } from "~/server/utils/branded";
import { createTestVolume } from "~/test/helpers/volume";
import { cryptoUtils } from "~/server/utils/crypto";

afterEach(() => {
	vi.restoreAllMocks();
	agentManagerMock.runVolumeCommand.mockReset();
});

beforeEach(() => {
	agentManagerMock.isAgentReady.mockReset();
	agentManagerMock.isAgentReady.mockResolvedValue(true);
});

describe("volumeService.getVolume", () => {
	test("should find volume by shortId", async () => {
		const { organizationId, user } = await createTestSession();
		agentManagerMock.runVolumeCommand.mockResolvedValue({
			name: "volume.statfs",
			result: { total: 100, used: 10, free: 90 },
		});

		const [volume] = await db
			.insert(volumesTable)
			.values({
				shortId: asShortId(randomUUID().slice(0, 8)),
				name: `test-vol-${randomUUID().slice(0, 8)}`,
				type: "directory",
				status: "mounted",
				config: { backend: "directory", path: "/" },
				autoRemount: true,
				organizationId,
			})
			.returning();

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.getVolume(volume.shortId);
			expect(result.volume.id).toBe(volume.id);
			expect(result.volume.shortId).toBe(volume.shortId);
			expect(result.volume.sourceLocation).toBeNull();
			expect(result.statfs).toEqual({ total: 100, used: 10, free: 90 });
			expect(presentedVolumeSchema.safeParse(result.volume).success).toBe(true);
		});
		expect(agentManagerMock.runVolumeCommand).toHaveBeenCalledOnce();
		expect(agentManagerMock.runVolumeCommand).toHaveBeenCalledWith(
			volume.agentId,
			organizationId,
			expect.objectContaining({ name: "volume.statfs", source: expect.objectContaining({ kind: "managed" }) }),
		);
	});

	test("should find volume by shortId from literal input", async () => {
		const { organizationId, user } = await createTestSession();

		const [volume] = await db
			.insert(volumesTable)
			.values({
				shortId: asShortId("test1234"),
				name: `test-vol-${randomUUID().slice(0, 8)}`,
				type: "directory",
				status: "mounted",
				config: { backend: "directory", path: "/" },
				autoRemount: true,
				organizationId,
			})
			.returning();

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.getVolume(volume.shortId);
			expect(result.volume.id).toBe(volume.id);
			expect(result.volume.shortId).toBe(volume.shortId);
		});
	});

	test("should find volume by numeric-looking shortId", async () => {
		const { organizationId, user } = await createTestSession();

		const [volume] = await db
			.insert(volumesTable)
			.values({
				shortId: asShortId("499780"),
				name: `test-vol-${randomUUID().slice(0, 8)}`,
				type: "directory",
				status: "mounted",
				config: { backend: "directory", path: "/" },
				autoRemount: true,
				organizationId,
			})
			.returning();

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.getVolume(asShortId("499780"));
			expect(result.volume.id).toBe(volume.id);
			expect(result.volume.shortId).toBe(asShortId("499780"));
		});
	});

	test("propagates managed execution-source assembly failures before statfs fallback", async () => {
		const { organizationId, user } = await createTestSession();
		vi.spyOn(cryptoUtils, "resolveSecret").mockRejectedValue(new Error("decryption failed"));
		const volume = await createTestVolume({
			organizationId,
			status: "mounted",
			config: {
				backend: "webdav",
				server: "example.test",
				path: "/dav",
				port: 443,
				username: "backup",
				password: "encrypted password",
				ssl: true,
			},
		});

		await withContext({ organizationId, userId: user.id }, async () => {
			await expect(volumeService.getVolume(volume.shortId)).rejects.toThrow("decryption failed");
		});
		expect(agentManagerMock.runVolumeCommand).not.toHaveBeenCalled();
	});

	test("falls back to empty statfs when the managed statfs command fails", async () => {
		const { organizationId, user } = await createTestSession();
		const volume = await createTestVolume({ organizationId, status: "mounted" });
		agentManagerMock.runVolumeCommand.mockRejectedValue(new Error("statfs unavailable"));
		const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.getVolume(volume.shortId);
			expect(result.statfs).toEqual({});
		});
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("statfs unavailable"));
	});

	test("should throw NotFoundError for non-existent volume", async () => {
		const { organizationId, user } = await createTestSession();

		await withContext({ organizationId, userId: user.id }, async () => {
			await expect(volumeService.getVolume(asShortId("nonexistent"))).rejects.toThrow("Volume not found");
		});
	});
});

describe("volumeService.listFiles security", () => {
	test("should reject traversal outside the volume root in listFiles", async () => {
		const { organizationId, user } = await createTestSession();
		agentManagerMock.runVolumeCommand.mockRejectedValue(new Error("Invalid path"));

		const [volume] = await db
			.insert(volumesTable)
			.values({
				shortId: asShortId(randomUUID().slice(0, 8)),
				name: `test-vol-${randomUUID().slice(0, 8)}`,
				type: "directory",
				status: "mounted",
				config: { backend: "directory", path: "/tmp/volume" },
				autoRemount: true,
				organizationId,
			})
			.returning();

		await withContext({ organizationId, userId: user.id }, async () => {
			await expect(volumeService.listFiles(volume.shortId, "../volume-secret")).rejects.toThrow("Invalid path");
		});
	});
});

describe("volumeService.mountVolume", () => {
	test("routes unmount and mount to the owning agent before updating state", async () => {
		const { organizationId, user } = await createTestSession();
		const volume = await createTestVolume({
			organizationId,
			status: "mounted",
			type: "nfs",
			config: { backend: "nfs", server: "nas", exportPath: "/data", version: "4", port: 2049, readOnly: false },
		});
		agentManagerMock.runVolumeCommand
			.mockResolvedValueOnce({ name: "volume.unmount", result: { status: "unmounted" } })
			.mockResolvedValueOnce({ name: "volume.mount", result: { status: "mounted" } });

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.mountVolume(volume.shortId);

			expect(result.status).toBe("mounted");
			expect(agentManagerMock.runVolumeCommand).toHaveBeenNthCalledWith(
				1,
				volume.agentId,
				organizationId,
				expect.objectContaining({ name: "volume.unmount", volume: expect.objectContaining({ id: volume.id }) }),
			);
			expect(agentManagerMock.runVolumeCommand).toHaveBeenNthCalledWith(
				2,
				volume.agentId,
				organizationId,
				expect.objectContaining({ name: "volume.mount", volume: expect.objectContaining({ id: volume.id }) }),
			);
		});
	});
});

describe("volumeService.unmountVolume", () => {
	test("persists the unmounted status for normal unmount requests", async () => {
		const { organizationId, user } = await createTestSession();
		const volume = await createTestVolume({
			organizationId,
			status: "mounted",
			type: "nfs",
			config: { backend: "nfs", server: "nas", exportPath: "/data", version: "4", port: 2049, readOnly: false },
		});
		agentManagerMock.runVolumeCommand.mockResolvedValueOnce({
			name: "volume.unmount",
			result: { status: "unmounted" },
		});

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.unmountVolume(volume.shortId);

			expect(result.status).toBe("unmounted");
			expect(agentManagerMock.runVolumeCommand).toHaveBeenCalledWith(
				volume.agentId,
				organizationId,
				expect.objectContaining({ name: "volume.unmount", volume: expect.objectContaining({ id: volume.id }) }),
			);
		});

		const updatedVolume = await db.query.volumesTable.findFirst({ where: { id: volume.id } });
		expect(updatedVolume?.status).toBe("unmounted");
	});
});

describe("volumeService.ensureHealthyVolume", () => {
	test("returns ready when the mounted volume passes its health check", async () => {
		const { organizationId, user } = await createTestSession();
		const volume = await createTestVolume({
			organizationId,
			status: "mounted",
			type: "nfs",
			config: { backend: "nfs", server: "nas", exportPath: "/data", version: "4", port: 2049, readOnly: false },
		});
		agentManagerMock.runVolumeCommand.mockResolvedValue({
			name: "volume.checkHealth",
			result: { status: "mounted" },
		});

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.ensureHealthyVolume(volume.shortId);

			expect(result).toEqual({
				ready: true,
				volume: expect.objectContaining({ id: volume.id, status: "mounted", lastError: null }),
				remounted: false,
			});
			expect(agentManagerMock.runVolumeCommand).toHaveBeenCalledOnce();
			expect(agentManagerMock.runVolumeCommand).toHaveBeenCalledWith(
				volume.agentId,
				organizationId,
				expect.objectContaining({
					name: "volume.checkHealth",
					volume: expect.objectContaining({ id: volume.id }),
				}),
			);
		});
	});

	test("auto-remounts when the mounted volume fails its health check", async () => {
		const { organizationId, user } = await createTestSession();
		const volume = await createTestVolume({
			organizationId,
			status: "mounted",
			type: "nfs",
			config: { backend: "nfs", server: "nas", exportPath: "/data", version: "4", port: 2049, readOnly: false },
			autoRemount: true,
		});
		agentManagerMock.runVolumeCommand
			.mockResolvedValueOnce({ name: "volume.checkHealth", result: { status: "error", error: "stale mount" } })
			.mockResolvedValueOnce({ name: "volume.unmount", result: { status: "unmounted" } })
			.mockResolvedValueOnce({ name: "volume.mount", result: { status: "mounted" } });

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.ensureHealthyVolume(volume.shortId);

			expect(result).toEqual({
				ready: true,
				volume: expect.objectContaining({ id: volume.id, status: "mounted", lastError: null }),
				remounted: true,
			});
			expect(agentManagerMock.runVolumeCommand).toHaveBeenCalledTimes(3);

			const updatedVolume = await db.query.volumesTable.findFirst({ where: { id: volume.id } });
			expect(updatedVolume?.status).toBe("mounted");
			expect(updatedVolume?.lastError).toBeNull();
		});
	});

	test("returns not ready when the health check fails and auto-remount is disabled", async () => {
		const { organizationId, user } = await createTestSession();
		const volume = await createTestVolume({
			organizationId,
			status: "mounted",
			type: "nfs",
			config: { backend: "nfs", server: "nas", exportPath: "/data", version: "4", port: 2049, readOnly: false },
			autoRemount: false,
		});
		agentManagerMock.runVolumeCommand.mockResolvedValue({
			name: "volume.checkHealth",
			result: { status: "error", error: "stale mount" },
		});

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.ensureHealthyVolume(volume.shortId);

			expect(result).toEqual({
				ready: false,
				volume: expect.objectContaining({ id: volume.id, status: "error", lastError: "stale mount" }),
				reason: "stale mount",
			});
			expect(agentManagerMock.runVolumeCommand).toHaveBeenCalledOnce();
		});
	});
});

describe("volumeService.testConnection", () => {
	test("routes test connections to the local agent", async () => {
		const { organizationId, user } = await createTestSession();
		agentManagerMock.runVolumeCommand.mockResolvedValue({
			name: "volume.testConnection",
			result: { success: true, message: "Connection successful" },
		});

		await withContext({ organizationId, userId: user.id }, async () => {
			await expect(
				volumeService.testConnection({
					backend: "nfs",
					server: "127.0.0.1",
					exportPath: "/exports/test",
					version: "4",
					port: 2049,
					readOnly: false,
				}),
			).resolves.toEqual({
				success: true,
				message: "Connection successful",
			});
		});

		expect(agentManagerMock.runVolumeCommand).toHaveBeenCalledWith(
			"local",
			organizationId,
			expect.objectContaining({ name: "volume.testConnection" }),
		);
	});
});

test.each(["unmounted", "error"] as const)(
	"recovers a directory saved as %s even when auto-remount is disabled",
	async (status) => {
		const { organizationId } = await createTestSession();
		const tempRoot = await mkdtemp(join(tmpdir(), "zerobyte-directory-recovery-"));
		const directoryPath = join(tempRoot, "folder");
		try {
			const volume = await createTestVolume({
				organizationId,
				status,
				autoRemount: false,
				config: { backend: "directory", path: directoryPath },
			});
			await withContext({ organizationId }, async () => {
				agentManagerMock.runVolumeCommand.mockResolvedValueOnce({
					name: "volume.checkHealth",
					result: { status: "error", error: "Directory not found" },
				});
				const unavailable = await volumeService.ensureHealthyVolume(volume.shortId);
				expect(unavailable.ready).toBe(false);
				expect(unavailable.volume.status).toBe("error");
				await mkdir(directoryPath);
				agentManagerMock.runVolumeCommand.mockResolvedValueOnce({
					name: "volume.checkHealth",
					result: { status: "mounted" },
				});
				const recovered = await volumeService.ensureHealthyVolume(volume.shortId);
				expect(recovered).toMatchObject({
					ready: true,
					remounted: false,
					volume: { status: "mounted", lastError: null },
				});
				agentManagerMock.runVolumeCommand.mockResolvedValueOnce({
					name: "volume.unmount",
					result: { status: "mounted" },
				});
				const unmounted = await volumeService.unmountVolume(volume.shortId);
				expect(unmounted.status).toBe("mounted");
				await rm(directoryPath, { recursive: true });
				await writeFile(directoryPath, "This is a file, not a folder.");
				agentManagerMock.runVolumeCommand.mockResolvedValueOnce({
					name: "volume.checkHealth",
					result: { status: "error", error: "Path is not a directory" },
				});
				const replacedWithFile = await volumeService.ensureHealthyVolume(volume.shortId);
				expect(replacedWithFile).toMatchObject({ ready: false, reason: "Path is not a directory" });
			});
		} finally {
			await rm(tempRoot, { recursive: true, force: true });
		}
	},
);

test("periodic health checks recover old unmounted directories without mounting network volumes", async () => {
	const { organizationId } = await createTestSession();
	const folderPath = await mkdtemp(join(tmpdir(), "zerobyte-directory-health-job-"));
	try {
		const directory = await createTestVolume({
			organizationId,
			status: "unmounted",
			autoRemount: false,
			config: { backend: "directory", path: folderPath },
		});
		const networkVolume = await createTestVolume({
			organizationId,
			status: "unmounted",
			type: "nfs",
			config: { backend: "nfs", server: "nas", exportPath: "/data", version: "4", port: 2049, readOnly: false },
			agentId: "remote-agent",
		});
		agentManagerMock.runVolumeCommand.mockResolvedValue({
			name: "volume.checkHealth",
			result: { status: "mounted" },
		});
		await new VolumeHealthCheckJob().run();
		const recovered = await db.query.volumesTable.findFirst({ where: { id: directory.id } });
		const network = await db.query.volumesTable.findFirst({ where: { id: networkVolume.id } });
		expect(recovered).toMatchObject({ status: "mounted", lastError: null });
		expect(network?.status).toBe("unmounted");
		expect(agentManagerMock.runVolumeCommand).not.toHaveBeenCalledWith("remote-agent", expect.anything());
		await rm(folderPath, { recursive: true });
		agentManagerMock.runVolumeCommand.mockResolvedValue({
			name: "volume.checkHealth",
			result: { status: "error", error: "Directory not found" },
		});
		await withContext({ organizationId }, () => volumeService.checkHealth(directory.shortId));
		await mkdir(folderPath);
		agentManagerMock.runVolumeCommand.mockResolvedValue({
			name: "volume.checkHealth",
			result: { status: "mounted" },
		});
		await new VolumeAutoRemountJob().run();
		const recoveredAgain = await db.query.volumesTable.findFirst({ where: { id: directory.id } });
		expect(recoveredAgain).toMatchObject({ status: "mounted", autoRemount: false, lastError: null });
	} finally {
		await rm(folderPath, { recursive: true, force: true });
	}
});
