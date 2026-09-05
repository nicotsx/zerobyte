import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { MAX_AGENT_TRUSTED_ROOTS } from "@zerobyte/contracts/agent-protocol";
import { presentedVolumeSchema } from "@zerobyte/contracts/volumes";
import { logger } from "@zerobyte/core/node";
import { db } from "~/server/db/db";
import { agentsTable } from "~/server/db/schema";
import { withContext } from "~/server/core/request-context";
import { createTestSession } from "~/test/helpers/auth";
import { createTestVolume } from "~/test/helpers/volume";
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

describe("trusted filesystem source presentation", () => {
	test("batch-presents shared source agents with one readiness lookup", async () => {
		const { organizationId, user } = await createTestSession();
		const { agentId, volume } = await createTrustedFilesystemSource(organizationId);
		const secondVolume = await createTestVolume({
			organizationId,
			agentId,
			sourceKind: "agent-filesystem",
			trustedRootId: "photos",
			relativePath: "documents",
			type: null,
			config: null,
			autoRemount: false,
		});

		await withContext({ organizationId, userId: user.id }, async () => {
			const presented = await volumeService.toPresentedVolumes([volume, secondVolume]);
			expect(presented.map((item) => item.sourceLocation?.availability)).toEqual(["available", "available"]);
		});
		expect(agentManagerMock.isAgentReady).toHaveBeenCalledOnce();
		expect(agentManagerMock.isAgentReady).toHaveBeenCalledWith(agentId);
	});

	test.each([
		["POSIX", "/srv/private"],
		["tilde", "~/home"],
		["bare tilde", "~"],
		["user tilde", "~backup"],
		["current directory", "."],
		["parent directory", ".."],
		["drive", "C:\\Users\\private"],
		["UNC", "\\\\server\\private"],
		["backslash", "private\\photos"],
		["control", "private\u0000photos"],
	] as const)("replaces %s path-like source-location labels", async (_kind, unsafeLabel) => {
		const { organizationId, user } = await createTestSession();
		const { agentId, volume } = await createTrustedFilesystemSource(organizationId);
		const capabilities = {
			trustedRoots: [{ id: "photos", label: unsafeLabel, canBackup: true }],
		};
		await db.update(agentsTable).set({ name: unsafeLabel, capabilities }).where(eq(agentsTable.id, agentId));

		await withContext({ organizationId, userId: user.id }, async () => {
			const presented = await volumeService.toPresentedVolume(volume);
			expect(presented.sourceLocation).toMatchObject({
				machine: { name: "Unnamed machine" },
				root: { label: "Allowed location" },
			});
			expect(JSON.stringify(presented.sourceLocation)).not.toContain(unsafeLabel);
		});
	});

	test("preserves normal source-location labels", async () => {
		const { organizationId, user } = await createTestSession();
		const { agentId, volume } = await createTrustedFilesystemSource(organizationId);
		const capabilities = {
			trustedRoots: [{ id: "photos", label: "Family photos", canBackup: true }],
		};
		await db.update(agentsTable).set({ name: "Family NAS", capabilities }).where(eq(agentsTable.id, agentId));

		await withContext({ organizationId, userId: user.id }, async () => {
			const presented = await volumeService.toPresentedVolume(volume);
			expect(presented.sourceLocation).toMatchObject({
				machine: { name: "Family NAS" },
				root: { label: "Family photos" },
			});
		});
	});

	test.each([
		["non-array", "invalid"],
		["malformed array", [{ id: "photos", label: "Photos", canBackup: "yes" }]],
		[
			"oversized array",
			Array.from({ length: MAX_AGENT_TRUSTED_ROOTS + 1 }, (_, index) => ({
				id: `root-${index}`,
				label: `Root ${index}`,
				canBackup: true,
			})),
		],
	] as const)("presents %s trusted roots as protocol-incompatible", async (_state, trustedRoots) => {
		const { organizationId, user } = await createTestSession();
		const { agentId, volume } = await createTrustedFilesystemSource(organizationId);
		await db.update(agentsTable).set({ capabilities: { trustedRoots } }).where(eq(agentsTable.id, agentId));

		await withContext({ organizationId, userId: user.id }, async () => {
			const presented = await volumeService.toPresentedVolume(volume);
			expect(presented.sourceLocation?.availability).toBe("incompatible");
		});
		expect(agentManagerMock.isAgentReady).not.toHaveBeenCalled();
	});

	test("passively presents a stale-mounted offline source without entering the execution path", async () => {
		const { organizationId, user } = await createTestSession();
		const { volume } = await createTrustedFilesystemSource(organizationId, "offline");
		const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.getVolume(volume.shortId);
			const presented = result.volume;
			expect(result.statfs).toEqual({});
			expect(presented).toMatchObject({
				sourceLocation: { availability: "offline", relativePath: "family" },
			});
			expect(presentedVolumeSchema.safeParse(presented).success).toBe(true);
		});
		expect(agentManagerMock.isAgentReady).not.toHaveBeenCalled();
		expect(agentManagerMock.runVolumeCommand).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
	});

	test("passively presents a stale-mounted source whose agent is missing", async () => {
		const { organizationId, user } = await createTestSession();
		const { agentId, volume } = await createTrustedFilesystemSource(organizationId);
		await db.delete(agentsTable).where(eq(agentsTable.id, agentId));
		const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.getVolume(volume.shortId);
			expect(result.statfs).toEqual({});
			expect(result.volume.sourceLocation).toMatchObject({
				machine: { id: agentId, name: "Unavailable machine", status: "offline" },
				availability: "missing-agent",
			});
		});
		expect(agentManagerMock.isAgentReady).not.toHaveBeenCalled();
		expect(agentManagerMock.runVolumeCommand).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
	});

	test("passively presents a mounted online source with one readiness lookup and no command", async () => {
		const { organizationId, user } = await createTestSession();
		const { agentId, volume } = await createTrustedFilesystemSource(organizationId);
		const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.getVolume(volume.shortId);
			expect(result.statfs).toEqual({});
			expect(result.volume.sourceLocation).toMatchObject({
				machine: { id: agentId, name: "NAS agent", status: "online" },
				availability: "available",
			});
		});
		expect(agentManagerMock.isAgentReady).toHaveBeenCalledOnce();
		expect(agentManagerMock.isAgentReady).toHaveBeenCalledWith(agentId);
		expect(agentManagerMock.runVolumeCommand).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
	});

	test("presents stable fallbacks for removed roots and missing machines without exposing host paths", async () => {
		const { organizationId, user } = await createTestSession();
		const { agentId, volume } = await createTrustedFilesystemSource(organizationId);
		await db
			.update(agentsTable)
			.set({ name: "\u0000", capabilities: { trustedRoots: [] } })
			.where(eq(agentsTable.id, agentId));

		await withContext({ organizationId, userId: user.id }, async () => {
			const removedRoot = await volumeService.toPresentedVolume(volume);
			expect(removedRoot).toMatchObject({
				sourceLocation: {
					machine: { name: "Unnamed machine" },
					root: { label: "Allowed location" },
					relativePath: "family",
					availability: "root-removed",
				},
			});

			await db.delete(agentsTable).where(eq(agentsTable.id, agentId));
			const missingResult = await volumeService.getVolume(volume.shortId);
			const missingAgent = missingResult.volume;
			expect(missingAgent).toMatchObject({
				sourceLocation: {
					machine: { name: "Unavailable machine" },
					root: { label: "Allowed location" },
					availability: "missing-agent",
				},
			});
			expect(presentedVolumeSchema.safeParse(missingAgent).success).toBe(true);
		});
	});
});
