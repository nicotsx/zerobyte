import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { BackendConfig } from "@zerobyte/contracts/volumes";
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

describe("trusted filesystem source actionability", () => {
	test("rejects traversal before contacting the source machine", async () => {
		const { organizationId, user } = await createTestSession();
		await withContext({ organizationId, userId: user.id }, async () => {
			await expect(
				volumeService.createVolume({
					name: "Traversal",
					sourceKind: "agent-filesystem",
					agentId: "agent-any",
					trustedRootId: "photos",
					relativePath: "../secret",
				}),
			).rejects.toThrow("cannot traverse outside its root");
		});
		expect(agentManagerMock.isAgentReady).not.toHaveBeenCalled();
		expect(agentManagerMock.runVolumeCommand).not.toHaveBeenCalled();
	});

	test.each([
		["config", { config: { backend: "directory", path: "/tmp" } }],
		["auto remount", { autoRemount: true }],
	] as const)("rejects the managed-only %s field for trusted filesystem sources", async (_field, patch) => {
		const { organizationId, user } = await createTestSession();
		const { volume } = await createTrustedFilesystemSource(organizationId);

		await withContext({ organizationId, userId: user.id }, async () => {
			await expect(volumeService.updateVolume(volume.shortId, patch)).rejects.toThrow(
				"cannot have managed backend fields",
			);
		});
	});

	test.each([
		["agent ID", { agentId: "local" }],
		["trusted root ID", { trustedRootId: "photos" }],
		["relative path", { relativePath: "family" }],
	] as const)("rejects the trusted-source %s field for managed volumes", async (_field, patch) => {
		const { organizationId, user } = await createTestSession();
		const volume = await createTestVolume({ organizationId });

		await withContext({ organizationId, userId: user.id }, async () => {
			await expect(volumeService.updateVolume(volume.shortId, patch)).rejects.toThrow(
				"cannot have trusted filesystem locations",
			);
		});
	});

	test("remounts a managed volume after its configuration changes", async () => {
		const { organizationId, user } = await createTestSession();
		const volume = await createTestVolume({ organizationId, autoRemount: false, status: "error" });
		const updatedConfig = { backend: "directory", path: "/mnt/updated" } satisfies BackendConfig;
		agentManagerMock.runVolumeCommand
			.mockResolvedValueOnce({ name: "volume.unmount", result: { status: "unmounted", error: undefined } })
			.mockResolvedValueOnce({ name: "volume.mount", result: { status: "mounted", error: undefined } });

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.updateVolume(volume.shortId, { config: updatedConfig });
			expect(result.volume).toMatchObject({
				sourceKind: "managed",
				config: updatedConfig,
				type: "directory",
				autoRemount: false,
			});
		});

		const persisted = await db.query.volumesTable.findFirst({ where: { id: volume.id } });
		expect(persisted).toMatchObject({
			config: updatedConfig,
			status: "mounted",
			lastError: null,
			autoRemount: false,
		});
		expect(agentManagerMock.runVolumeCommand).toHaveBeenNthCalledWith(
			1,
			volume.agentId,
			organizationId,
			expect.objectContaining({ name: "volume.unmount" }),
		);
		expect(agentManagerMock.runVolumeCommand).toHaveBeenNthCalledWith(
			2,
			volume.agentId,
			organizationId,
			expect.objectContaining({ name: "volume.mount" }),
		);
	});

	test("rejects source-kind conversion and incomplete location changes", async () => {
		const { organizationId, user } = await createTestSession();
		const { volume } = await createTrustedFilesystemSource(organizationId);

		await withContext({ organizationId, userId: user.id }, async () => {
			await expect(volumeService.updateVolume(volume.shortId, { sourceKind: "managed" })).rejects.toThrow(
				"source kind cannot be changed",
			);
			await expect(volumeService.updateVolume(volume.shortId, { agentId: "another-agent" })).rejects.toThrow(
				"requires a trusted root ID",
			);
			await expect(volumeService.updateVolume(volume.shortId, { trustedRootId: "archive" })).rejects.toThrow(
				"requires an explicit relative path",
			);
		});
	});

	test("rejects creating a source from an offline agent's last advertised root", async () => {
		const { organizationId, user } = await createTestSession();
		const agentId = `agent-${randomUUID()}`;
		await db.insert(agentsTable).values({
			id: agentId,
			organizationId,
			name: "NAS agent",
			kind: "remote",
			status: "offline",
			capabilities: {
				trustedRoots: [{ id: "photos", label: "Photos", canBackup: true }],
			},
		});

		await withContext({ organizationId, userId: user.id }, async () => {
			await expect(
				volumeService.createVolume({
					name: "Family photos",
					sourceKind: "agent-filesystem",
					agentId,
					trustedRootId: "photos",
					relativePath: "family/./2026",
				}),
			).rejects.toThrow("is offline");
		});
	});

	test("rejects roots that were not advertised by the selected agent", async () => {
		const { organizationId, user } = await createTestSession();
		const agentId = `agent-${randomUUID()}`;
		await db.insert(agentsTable).values({
			id: agentId,
			organizationId,
			name: "NAS agent",
			kind: "remote",
			status: "online",
			capabilities: { trustedRoots: [] },
		});

		await withContext({ organizationId, userId: user.id }, async () => {
			await expect(
				volumeService.createVolume({
					name: "Secrets",
					sourceKind: "agent-filesystem",
					agentId,
					trustedRootId: "missing",
					relativePath: "",
				}),
			).rejects.toThrow('Trusted root "missing" is not advertised');
		});
	});
});
