import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { LOCAL_FILESYSTEM_ROOT_ID } from "@zerobyte/contracts/volumes";
import { LOCAL_AGENT_ID } from "../../agents/constants";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { fromPartial } from "@total-typescript/shoehorn";
import { parseAgentMessage, type AgentWireMessage, type FilesystemCommand } from "@zerobyte/contracts/agent-protocol";
import { db } from "~/server/db/db";
import { agentsTable } from "~/server/db/schema";
import { withContext } from "~/server/core/request-context";
import { createTestSession } from "~/test/helpers/auth";
import { handleFilesystemCommand } from "../../../../../apps/agent/src/commands/filesystem";
import type { ControllerCommandContext } from "../../../../../apps/agent/src/context";
import { createTrustedRootRegistry, getTrustedRootDescriptors } from "../../../../../apps/agent/src/trusted-roots";
import { createTrustedFilesystemSource } from "./trusted-filesystem-source.fixture";

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
	agentManagerMock.isAgentReady.mockResolvedValue(true);
});

describe("trusted filesystem source browsing", () => {
	test.each(["connecting", "degraded", "offline"] as const)(
		"rejects %s machines before remote source actions",
		async (status) => {
			const { organizationId, user } = await createTestSession();
			const { agentId } = await createTrustedFilesystemSource(organizationId, "online");
			await db.update(agentsTable).set({ status }).where(eq(agentsTable.id, agentId));
			await withContext({ organizationId, userId: user.id }, async () => {
				await expect(volumeService.browseFilesystem(agentId, "photos", "/")).rejects.toThrow(`is ${status}`);
			});
		},
	);

	test("rejects revoked, disconnected, missing, malformed, and non-backup-capable source descriptors", async () => {
		const { organizationId, user } = await createTestSession();
		const { agentId } = await createTrustedFilesystemSource(organizationId);

		await withContext({ organizationId, userId: user.id }, async () => {
			await db.update(agentsTable).set({ revokedAt: Date.now() }).where(eq(agentsTable.id, agentId));
			await expect(volumeService.browseFilesystem(agentId, "photos", "/")).rejects.toThrow("is revoked");

			await db
				.update(agentsTable)
				.set({ revokedAt: null, capabilities: { trustedRoots: [] } })
				.where(eq(agentsTable.id, agentId));
			await expect(volumeService.browseFilesystem(agentId, "photos", "/")).rejects.toThrow("not advertised");

			await db
				.update(agentsTable)
				.set({
					capabilities: {
						trustedRoots: [{ id: "photos", label: "Photos", canBackup: false }],
					},
				})
				.where(eq(agentsTable.id, agentId));
			await expect(volumeService.browseFilesystem(agentId, "photos", "/")).rejects.toThrow(
				"does not allow backups",
			);

			await db
				.update(agentsTable)
				.set({ capabilities: { trustedRoots: "invalid" } })
				.where(eq(agentsTable.id, agentId));
			await expect(volumeService.browseFilesystem(agentId, "photos", "/")).rejects.toThrow("incompatible");

			await expect(volumeService.browseFilesystem("missing-agent", "photos", "/")).rejects.toThrow(
				"Source machine not found",
			);

			await db
				.update(agentsTable)
				.set({
					capabilities: {
						trustedRoots: [{ id: "photos", label: "Photos", canBackup: true }],
					},
				})
				.where(eq(agentsTable.id, agentId));
			agentManagerMock.isAgentReady.mockResolvedValue(false);
			await expect(volumeService.browseFilesystem(agentId, "photos", "/")).rejects.toThrow("is not connected");
		});
	});

	test("browses with a root reference instead of an absolute host path", async () => {
		const { organizationId, user } = await createTestSession();
		const agentId = `agent-${randomUUID()}`;
		await db.insert(agentsTable).values({
			id: agentId,
			organizationId,
			name: "NAS agent",
			kind: "remote",
			status: "online",
			capabilities: {
				trustedRoots: [{ id: "photos", label: "Photos", canBackup: true }],
			},
		});
		agentManagerMock.runFilesystemCommand.mockResolvedValue({
			name: "filesystem.browse",
			result: { directories: [], path: "family" },
		});

		await withContext({ organizationId, userId: user.id }, async () => {
			await volumeService.browseFilesystem(agentId, "photos", "/family");
		});

		expect(agentManagerMock.runFilesystemCommand).toHaveBeenCalledWith(agentId, organizationId, {
			name: "filesystem.browse",
			source: { rootId: "photos", relativePath: "family" },
		});
	});

	test.each([false, true])(
		"round-trips logical browse paths across two levels, builtinLocal=%s",
		async (builtinLocal) => {
			const { organizationId, user } = await createTestSession();
			const agentId = builtinLocal ? LOCAL_AGENT_ID : `agent-${randomUUID()}`;
			const rootId = builtinLocal ? LOCAL_FILESYSTEM_ROOT_ID : "filesystem";
			const rawRoots = JSON.stringify([{ id: "filesystem", label: "Filesystem", path: "/" }]);
			const registry = createTrustedRootRegistry({ rawRoots, builtinLocal });
			await db.insert(agentsTable).values({
				id: agentId,
				organizationId: builtinLocal ? null : organizationId,
				name: "Filesystem agent",
				kind: builtinLocal ? "local" : "remote",
				status: "online",
				capabilities: { filesystem: true, trustedRoots: getTrustedRootDescriptors(registry) },
			});
			agentManagerMock.runFilesystemCommand.mockImplementation(
				async (_agentId: string, _organizationId: string, command: FilesystemCommand) => {
					const outboundMessages: AgentWireMessage[] = [];
					const context = fromPartial<ControllerCommandContext>({
						trustedRoots: registry,
						offerOutbound: (message: AgentWireMessage) =>
							Effect.sync(() => {
								outboundMessages.push(message);
								return true;
							}),
					});
					const commandId = randomUUID();
					const payload = { commandId, command };
					await Effect.runPromise(handleFilesystemCommand(context, payload));
					const outboundMessage = outboundMessages[0];
					const parsedMessage = parseAgentMessage(outboundMessage);
					if (!parsedMessage?.success || parsedMessage.data.type !== "filesystem.commandResult") {
						throw new Error("Agent returned an invalid browse response");
					}
					if (parsedMessage.data.payload.status !== "success") {
						throw new Error(parsedMessage.data.payload.error);
					}
					return parsedMessage.data.payload.command;
				},
			);
			const canonicalWorkingDirectory = fs.realpathSync.native(process.cwd());
			const pathSegments = canonicalWorkingDirectory.split(path.sep).filter(Boolean);
			const firstSegment = pathSegments[0];
			const secondSegment = pathSegments[1];
			if (!firstSegment || !secondSegment) {
				throw new Error("Expected the working directory to have at least two path segments");
			}

			await withContext({ organizationId, userId: user.id }, async () => {
				const rootResult = await volumeService.browseFilesystem(agentId, rootId, "/");
				expect(rootResult.path).toBe("trusted-root:");
				const firstDirectory = rootResult.directories.find((directory) => directory.name === firstSegment);
				expect(firstDirectory?.path).toBe(`trusted-root:${firstSegment}`);
				if (!firstDirectory) {
					throw new Error(`Expected root browse result to contain ${firstSegment}`);
				}

				const directoryResult = await volumeService.browseFilesystem(agentId, rootId, firstDirectory.path);
				expect(directoryResult.path).toBe(firstDirectory.path);
				const secondDirectory = directoryResult.directories.find(
					(directory) => directory.name === secondSegment,
				);
				expect(secondDirectory?.path).toBe(`trusted-root:${firstSegment}/${secondSegment}`);
				if (!secondDirectory) {
					throw new Error(`Expected nested browse result to contain ${secondSegment}`);
				}

				const childResult = await volumeService.browseFilesystem(agentId, rootId, secondDirectory.path);
				expect(childResult.path).toBe(secondDirectory.path);
			});
		},
	);
});
