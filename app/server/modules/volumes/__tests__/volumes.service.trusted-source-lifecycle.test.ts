import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/db";
import { agentsTable, volumesTable } from "~/server/db/schema";
import { withContext } from "~/server/core/request-context";
import { createTestSession } from "~/test/helpers/auth";
import { createTrustedFilesystemSource } from "./trusted-filesystem-source.fixture";

const agentManagerMock = vi.hoisted(() => ({
	isAgentReady: vi.fn(),
	runVolumeCommand: vi.fn(),
}));

vi.mock("../../agents/agents-manager", () => ({
	agentManager: agentManagerMock,
}));

import { volumeService } from "../volume.service";

afterEach(() => {
	vi.restoreAllMocks();
	agentManagerMock.runVolumeCommand.mockReset();
});

beforeEach(() => {
	agentManagerMock.isAgentReady.mockReset();
	agentManagerMock.isAgentReady.mockResolvedValue(true);
});

describe("trusted filesystem source lifecycle", () => {
	test("creates an online whole-root source only after a successful statfs preflight", async () => {
		const { organizationId, user } = await createTestSession();
		const agentId = `agent-${randomUUID()}`;
		await db.insert(agentsTable).values({
			id: agentId,
			organizationId,
			name: "NAS agent",
			kind: "remote",
			status: "online",
			capabilities: { trustedRoots: [{ id: "photos", label: "Photos", canBackup: true }] },
		});
		agentManagerMock.runVolumeCommand.mockResolvedValue({
			name: "volume.statfs",
			result: { total: 100, used: 10, free: 90 },
		});

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.createVolume({
				name: "All photos",
				sourceKind: "agent-filesystem",
				agentId,
				trustedRootId: "photos",
				relativePath: "",
			});
			expect(result.volume.relativePath).toBe("");
		});
		expect(agentManagerMock.runVolumeCommand).toHaveBeenCalledWith(agentId, organizationId, {
			name: "volume.statfs",
			source: { kind: "agent-filesystem", reference: { rootId: "photos", relativePath: "" } },
		});
	});

	test("does not persist a source when statfs preflight fails", async () => {
		const { organizationId, user } = await createTestSession();
		const agentId = `agent-${randomUUID()}`;
		await db.insert(agentsTable).values({
			id: agentId,
			organizationId,
			name: "NAS agent",
			kind: "remote",
			status: "online",
			capabilities: { trustedRoots: [{ id: "photos", label: "Photos", canBackup: true }] },
		});
		agentManagerMock.runVolumeCommand.mockRejectedValue(new Error("path missing"));

		await withContext({ organizationId, userId: user.id }, async () => {
			await expect(
				volumeService.createVolume({
					name: "Missing photos",
					sourceKind: "agent-filesystem",
					agentId,
					trustedRootId: "photos",
					relativePath: "missing",
				}),
			).rejects.toThrow("path missing");
		});
		const persisted = await db.query.volumesTable.findFirst({ where: { name: "Missing photos", organizationId } });
		expect(persisted).toBeUndefined();
	});

	test("allows name-only edits while offline but preflights changed locations", async () => {
		const { organizationId, user } = await createTestSession();
		const { agentId, volume } = await createTrustedFilesystemSource(organizationId, "offline");
		const staleHealthCheck = 1_000;
		await db
			.update(volumesTable)
			.set({ status: "error", lastError: "source disappeared", lastHealthCheck: staleHealthCheck })
			.where(eq(volumesTable.id, volume.id));

		await withContext({ organizationId, userId: user.id }, async () => {
			const renamed = await volumeService.updateVolume(volume.shortId, {
				sourceKind: "agent-filesystem",
				name: "Renamed offline",
			});
			expect(renamed.volume.name).toBe("Renamed offline");
			expect(renamed.volume.status).toBe("error");
			expect(renamed.volume.lastError).toBe("source disappeared");
			expect(renamed.volume.lastHealthCheck).toBe(staleHealthCheck);
			await expect(volumeService.updateVolume(volume.shortId, { relativePath: "other" })).rejects.toThrow(
				"is offline",
			);
		});
		expect(agentManagerMock.runVolumeCommand).not.toHaveBeenCalled();
		expect(agentId).toBe(volume.agentId);
	});

	test("resets stale health atomically after a changed location passes preflight", async () => {
		const { organizationId, user } = await createTestSession();
		const { volume } = await createTrustedFilesystemSource(organizationId);
		const staleHealthCheck = 1_000;
		await db
			.update(volumesTable)
			.set({ status: "error", lastError: "old location missing", lastHealthCheck: staleHealthCheck })
			.where(eq(volumesTable.id, volume.id));
		agentManagerMock.runVolumeCommand.mockResolvedValue({
			name: "volume.statfs",
			result: { total: 100, used: 10, free: 90 },
		});
		const beforeUpdate = Date.now();

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.updateVolume(volume.shortId, { relativePath: "archive" });
			expect(result.volume.relativePath).toBe("archive");
			expect(result.volume.status).toBe("mounted");
			expect(result.volume.lastError).toBeNull();
			expect(result.volume.lastHealthCheck).toBeGreaterThanOrEqual(beforeUpdate);
		});
	});

	test("leaves the complete source row unchanged when changed-location preflight fails", async () => {
		const { organizationId, user } = await createTestSession();
		const { volume } = await createTrustedFilesystemSource(organizationId);
		const staleHealthCheck = 1_000;
		await db
			.update(volumesTable)
			.set({ status: "error", lastError: "old location missing", lastHealthCheck: staleHealthCheck })
			.where(eq(volumesTable.id, volume.id));
		const beforeUpdate = await db.query.volumesTable.findFirst({ where: { id: volume.id } });
		agentManagerMock.runVolumeCommand.mockRejectedValue(new Error("new location missing"));

		await withContext({ organizationId, userId: user.id }, async () => {
			await expect(
				volumeService.updateVolume(volume.shortId, { name: "Should not persist", relativePath: "missing" }),
			).rejects.toThrow("new location missing");
		});
		const afterUpdate = await db.query.volumesTable.findFirst({ where: { id: volume.id } });
		expect(afterUpdate).toEqual(beforeUpdate);
	});

	test.each([
		["offline agent", "Agent is offline"],
		["missing trusted path", "Trusted source path cannot be resolved"],
	])("persists a not-ready health result for an %s", async (_scenario, failureMessage) => {
		const { organizationId, user } = await createTestSession();
		const { volume } = await createTrustedFilesystemSource(organizationId);
		agentManagerMock.runVolumeCommand.mockRejectedValue(new Error(failureMessage));

		const beforeCheck = Date.now();
		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.ensureHealthyVolume(volume.shortId);
			expect(result).toEqual({
				ready: false,
				volume: expect.objectContaining({ status: "error", lastError: failureMessage }),
				reason: failureMessage,
			});
		});

		const persisted = await db.query.volumesTable.findFirst({ where: { id: volume.id } });
		expect(persisted?.status).toBe("error");
		expect(persisted?.lastError).toBe(failureMessage);
		expect(persisted?.lastHealthCheck).toBeGreaterThanOrEqual(beforeCheck);
	});

	test("persists recovery after a trusted source becomes reachable", async () => {
		const { organizationId, user } = await createTestSession();
		const { volume } = await createTrustedFilesystemSource(organizationId);
		agentManagerMock.runVolumeCommand
			.mockRejectedValueOnce(new Error("Agent is offline"))
			.mockResolvedValueOnce({ name: "volume.statfs", result: { total: 100, used: 10, free: 90 } });

		await withContext({ organizationId, userId: user.id }, async () => {
			const failed = await volumeService.checkHealth(volume.shortId);
			expect(failed.status).toBe("error");
			const recovered = await volumeService.ensureHealthyVolume(volume.shortId);
			expect(recovered).toEqual({
				ready: true,
				volume: expect.objectContaining({ status: "mounted", lastError: null }),
				remounted: false,
			});
		});

		const persisted = await db.query.volumesTable.findFirst({ where: { id: volume.id } });
		expect(persisted?.status).toBe("mounted");
		expect(persisted?.lastError).toBeNull();
	});
});
