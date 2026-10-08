import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/db";
import { agentsTable, volumesTable } from "~/server/db/schema";
import { withContext } from "~/server/core/request-context";
import { createTestSession } from "~/test/helpers/auth";
import { createTrustedFilesystemSource } from "./trusted-filesystem-source.fixture";
import { createTestVolume } from "~/test/helpers/volume";

const agentManagerMock = vi.hoisted(() => ({
	isAgentReady: vi.fn(),
	runFilesystemCommand: vi.fn(),
}));

vi.mock("../../agents/agents-manager", () => ({
	agentManager: agentManagerMock,
}));

import { volumeService } from "../volume.service";

afterEach(() => {
	vi.restoreAllMocks();
	agentManagerMock.runFilesystemCommand.mockReset();
});

beforeEach(() => {
	agentManagerMock.isAgentReady.mockReset();
	agentManagerMock.isAgentReady.mockReturnValue(true);
});

describe("trusted filesystem source lifecycle", () => {
	test("releases a timed-out optional capacity lookup and still returns volume details", async () => {
		const { organizationId } = await createTestSession();
		const volume = await createTestVolume({ organizationId, status: "mounted" });
		const started = Promise.withResolvers<void>();
		let released = false;
		agentManagerMock.runFilesystemCommand.mockReturnValue(
			Effect.sync(() => started.resolve()).pipe(
				Effect.andThen(Effect.never),
				Effect.ensuring(
					Effect.sync(() => {
						released = true;
					}),
				),
			),
		);
		vi.useFakeTimers();

		try {
			const detail = withContext({ organizationId }, () => volumeService.getVolume(volume.shortId));
			await started.promise;
			await vi.advanceTimersByTimeAsync(1000);

			await expect(detail).resolves.toMatchObject({ volume: { shortId: volume.shortId }, statfs: {} });
			expect(released).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	test("cancels a pending health check without persisting a source failure", async () => {
		const { organizationId } = await createTestSession();
		const { volume } = await createTrustedFilesystemSource(organizationId);
		const started = Promise.withResolvers<void>();
		let released = false;
		agentManagerMock.runFilesystemCommand.mockReturnValue(
			Effect.sync(() => started.resolve()).pipe(
				Effect.andThen(Effect.never),
				Effect.ensuring(
					Effect.sync(() => {
						released = true;
					}),
				),
			),
		);
		const controller = new AbortController();
		const reason = new Error("Health check cancelled");

		const health = withContext({ organizationId }, () =>
			volumeService.ensureHealthyVolume(volume, controller.signal),
		);
		const rejection = expect(health).rejects.toBe(reason);
		await started.promise;
		controller.abort(reason);
		await rejection;

		expect(released).toBe(true);
		expect(await db.query.volumesTable.findFirst({ where: { id: volume.id } })).toEqual(volume);
	});

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
		agentManagerMock.runFilesystemCommand.mockReturnValue(
			Effect.succeed({
				name: "filesystem.statfs",
				result: { total: 100, used: 10, free: 90 },
			}),
		);

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.createVolume({
				name: "All photos",
				sourceKind: "filesystem",
				agentId,
				trustedRootId: "photos",
				relativePath: "",
			});
			expect(result.volume.relativePath).toBe("");
		});
		expect(agentManagerMock.runFilesystemCommand).toHaveBeenCalledWith(agentId, organizationId, {
			name: "filesystem.statfs",
			source: { rootId: "photos", relativePath: "" },
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
		agentManagerMock.runFilesystemCommand.mockReturnValue(Effect.fail(new Error("path missing")));

		await withContext({ organizationId, userId: user.id }, async () => {
			await expect(
				volumeService.createVolume({
					name: "Missing photos",
					sourceKind: "filesystem",
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
				name: "Renamed offline",
			});
			expect(renamed.volume.name).toBe("Renamed offline");
			expect(renamed.volume.status).toBe("error");
			expect(renamed.volume.lastError).toBe("source disappeared");
			expect(renamed.volume.lastHealthCheck).toBe(staleHealthCheck);
			const unchangedLocation = await volumeService.updateVolume(volume.shortId, {
				agentId: volume.agentId,
				trustedRootId: "photos",
				relativePath: "family/./",
			});
			expect(unchangedLocation.volume).toMatchObject({
				status: "error",
				lastError: "source disappeared",
				lastHealthCheck: staleHealthCheck,
				relativePath: "family",
			});
			agentManagerMock.runFilesystemCommand.mockReturnValue(Effect.fail(new Error("Source machine is offline")));
			await expect(
				volumeService.updateVolume(volume.shortId, {
					agentId: volume.agentId,
					trustedRootId: "photos",
					relativePath: "other",
				}),
			).rejects.toThrow("is offline");
		});
		expect(agentManagerMock.runFilesystemCommand).toHaveBeenCalledOnce();
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
		agentManagerMock.runFilesystemCommand.mockReturnValue(
			Effect.succeed({
				name: "filesystem.statfs",
				result: { total: 100, used: 10, free: 90 },
			}),
		);
		const beforeUpdate = Date.now();

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.updateVolume(volume.shortId, {
				agentId: volume.agentId,
				trustedRootId: "photos",
				relativePath: "archive",
			});
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
		agentManagerMock.runFilesystemCommand.mockReturnValue(Effect.fail(new Error("new location missing")));

		await withContext({ organizationId, userId: user.id }, async () => {
			await expect(
				volumeService.updateVolume(volume.shortId, {
					name: "Should not persist",
					agentId: volume.agentId,
					trustedRootId: "photos",
					relativePath: "missing",
				}),
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
		agentManagerMock.runFilesystemCommand.mockReturnValue(Effect.fail(new Error(failureMessage)));

		const beforeCheck = Date.now();
		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.ensureHealthyVolume(volume);
			expect(result).toEqual({
				ready: false,
				reason: `Filesystem source is unavailable: ${failureMessage}`,
			});
		});

		const persisted = await db.query.volumesTable.findFirst({ where: { id: volume.id } });
		expect(persisted?.status).toBe("error");
		expect(persisted?.lastError).toContain(failureMessage);
		expect(persisted?.lastHealthCheck).toBeGreaterThanOrEqual(beforeCheck);
	});

	test("persists recovery after a trusted source becomes reachable", async () => {
		const { organizationId, user } = await createTestSession();
		const { volume } = await createTrustedFilesystemSource(organizationId);
		agentManagerMock.runFilesystemCommand
			.mockReturnValueOnce(Effect.fail(new Error("Agent is offline")))
			.mockReturnValueOnce(
				Effect.succeed({ name: "filesystem.statfs", result: { total: 100, used: 10, free: 90 } }),
			);

		await withContext({ organizationId, userId: user.id }, async () => {
			const failed = await volumeService.checkHealth(volume.shortId);
			expect(failed.status).toBe("error");
			const recovered = await volumeService.ensureHealthyVolume(volume);
			expect(recovered).toEqual({
				ready: true,
				remounted: false,
			});
		});

		const persisted = await db.query.volumesTable.findFirst({ where: { id: volume.id } });
		expect(persisted?.status).toBe("mounted");
		expect(persisted?.lastError).toBeNull();
	});
});
