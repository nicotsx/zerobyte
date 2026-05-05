import { afterEach, describe, expect, test, vi } from "vitest";
const agentManagerMock = vi.hoisted(() => ({
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
import { config } from "~/server/core/config";

afterEach(() => {
	config.flags.enableLocalAgent = false;
	vi.restoreAllMocks();
	agentManagerMock.runVolumeCommand.mockReset();
});

describe("volumeService.getVolume", () => {
	test("should find volume by shortId", async () => {
		const { organizationId, user } = await createTestSession();

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
		});
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
		const volume = await createTestVolume({ organizationId, status: "mounted", agentId: "agent-1" });
		agentManagerMock.runVolumeCommand
			.mockResolvedValueOnce({ name: "volume.unmount", result: { status: "unmounted" } })
			.mockResolvedValueOnce({ name: "volume.mount", result: { status: "mounted" } });

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.mountVolume(volume.shortId);

			expect(result.status).toBe("mounted");
			expect(agentManagerMock.runVolumeCommand).toHaveBeenNthCalledWith(
				1,
				volume.agentId,
				expect.objectContaining({ name: "volume.unmount", volume: expect.objectContaining({ id: volume.id }) }),
			);
			expect(agentManagerMock.runVolumeCommand).toHaveBeenNthCalledWith(
				2,
				volume.agentId,
				expect.objectContaining({ name: "volume.mount", volume: expect.objectContaining({ id: volume.id }) }),
			);
		});
	});
});

describe("volumeService.ensureHealthyVolume", () => {
	test("returns ready when the mounted volume passes its health check", async () => {
		const { organizationId, user } = await createTestSession();
		const volume = await createTestVolume({ organizationId, status: "mounted", agentId: "agent-1" });
		agentManagerMock.runVolumeCommand.mockResolvedValue({ name: "volume.checkHealth", result: { status: "mounted" } });

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
				expect.objectContaining({ name: "volume.checkHealth", volume: expect.objectContaining({ id: volume.id }) }),
			);
		});
	});

	test("auto-remounts when the mounted volume fails its health check", async () => {
		const { organizationId, user } = await createTestSession();
		const volume = await createTestVolume({ organizationId, status: "mounted", autoRemount: true, agentId: "agent-1" });
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
			autoRemount: false,
			agentId: "agent-1",
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
		config.flags.enableLocalAgent = true;
		agentManagerMock.runVolumeCommand.mockResolvedValue({
			name: "volume.testConnection",
			result: { success: true, message: "Connection successful" },
		});

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

		expect(agentManagerMock.runVolumeCommand).toHaveBeenCalledWith(
			"local",
			expect.objectContaining({ name: "volume.testConnection" }),
		);
	});
});
