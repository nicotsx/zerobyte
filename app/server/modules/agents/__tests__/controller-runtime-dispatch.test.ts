import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { expect, test, vi } from "vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import {
	createAgentMessage,
	parseControllerMessage,
	type FilesystemCommand,
	type FilesystemCommandPayload,
	type FilesystemCommandResponsePayload,
} from "@zerobyte/contracts/agent-protocol";
import { createTrustedRootRegistry, getTrustedRootDescriptors } from "../../../../../apps/agent/src/trusted-roots";
import type { AgentConnectionData } from "../controller/session";
import { createSocket, readyPayload, startRuntime } from "./controller-runtime.test-utils";

const data = {
	id: "connection-1",
	agentId: "agent-1",
	organizationId: "org-1",
	agentName: "Agent 1",
	agentKind: "remote",
	credentialVersion: 1,
} satisfies AgentConnectionData;

test("dispatches filesystem commands for advertised remote roots", async () => {
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime();
	const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-runtime-dispatch-"));
	try {
		const rawRoots = JSON.stringify([{ id: "data", label: "Data", path: rootPath }]);
		const trustedRootRegistry = createTrustedRootRegistry({ rawRoots });
		const capabilities = { filesystem: true, trustedRoots: getTrustedRootDescriptors(trustedRootRegistry) };
		const socket = createSocket(data.id, data.agentId);
		const sentCommands: FilesystemCommandPayload[] = [];
		socket.send.mockImplementation((text) => {
			const message = parseControllerMessage(text);
			if (!message?.success) throw new Error("Expected a valid controller message");
			if (message.data.type === "filesystem.command") sentCommands.push(message.data.payload);
			return 1;
		});
		await runtime.openConnection(data, { send: socket.send, close: socket.close });
		const ready = { ...readyPayload, agentId: data.agentId, capabilities };
		await runtime.handleConnectionMessage(data.agentId, data.id, createAgentMessage("agent.ready", ready));
		await expect(runtime.waitForAgentReady(data.agentId, 0)).resolves.toBe(true);
		const trustedReference = { rootId: "data", relativePath: "photos" };
		const trustedCommands = [
			{ name: "filesystem.browse", source: trustedReference },
			{ name: "filesystem.statfs", source: trustedReference },
			{
				name: "filesystem.listFiles",
				source: trustedReference,
				offset: 0,
				limit: 100,
			},
		] satisfies FilesystemCommand[];
		const unknownRootCommand = {
			name: "filesystem.statfs",
			source: { rootId: "unadvertised", relativePath: "" },
		} satisfies FilesystemCommand;

		for (const command of trustedCommands) {
			const expectedCount = sentCommands.length + 1;
			const result = Effect.runPromise(runtime.runFilesystemCommand(data.agentId, "org-1", command));
			await vi.waitFor(() => expect(sentCommands).toHaveLength(expectedCount));
			const sent = sentCommands.at(-1);
			if (!sent) throw new Error("Expected a filesystem command");
			expect(sent.command).toEqual(command);
			const response = {
				commandId: sent.commandId,
				status: "error",
				error: "expected test response",
			} satisfies FilesystemCommandResponsePayload;
			await runtime.handleConnectionMessage(
				data.agentId,
				data.id,
				createAgentMessage("filesystem.commandResult", response),
			);
			await expect(result).resolves.toEqual(response);
		}
		await expect(
			Effect.runPromise(runtime.runFilesystemCommand(data.agentId, "org-1", unknownRootCommand)),
		).resolves.toBeNull();
		expect(sentCommands).toHaveLength(trustedCommands.length);
	} finally {
		await Effect.runPromise(runtime.stop);
		fs.rmSync(rootPath, { recursive: true, force: true });
	}
});

test.each([
	["local", true],
	["remote", true],
	["local", false],
	["remote", false],
] as const)(
	"dispatches logical sources only when their root is advertised: agentKind=%s, advertised=%s",
	async (agentKind, advertised) => {
		vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
		const { runtime } = await startRuntime();
		const connection = { ...data, agentKind };
		const socket = createSocket(connection.id, connection.agentId);
		const sentCommands: FilesystemCommandPayload[] = [];
		socket.send.mockImplementation((text) => {
			const message = parseControllerMessage(text);
			if (message?.success && message.data.type === "filesystem.command") sentCommands.push(message.data.payload);
			return 1;
		});

		try {
			await runtime.openConnection(connection, { send: socket.send, close: socket.close });
			await runtime.handleConnectionMessage(
				connection.agentId,
				connection.id,
				createAgentMessage("agent.ready", {
					...readyPayload,
					agentId: connection.agentId,
					capabilities: {
						filesystem: true,
						trustedRoots: advertised
							? [{ id: "local-filesystem", label: "Filesystem", canBackup: true }]
							: [],
					},
				}),
			);
			const command = {
				name: "filesystem.statfs",
				source: { rootId: "local-filesystem", relativePath: "" },
			} satisfies FilesystemCommand;
			const result = Effect.runPromise(runtime.runFilesystemCommand(connection.agentId, "org-1", command));

			if (!advertised) {
				await expect(result).resolves.toBeNull();
				expect(sentCommands).toEqual([]);
				return;
			}

			await vi.waitFor(() => expect(sentCommands).toHaveLength(1));
			const sent = sentCommands[0]!;
			expect(sent.command).toEqual(command);
			const response = {
				commandId: sent.commandId,
				status: "success",
				command: { name: "filesystem.statfs", result: { total: 100, used: 10, free: 90 } },
			} satisfies FilesystemCommandResponsePayload;
			await runtime.handleConnectionMessage(
				connection.agentId,
				connection.id,
				createAgentMessage("filesystem.commandResult", response),
			);
			await expect(result).resolves.toEqual(response);
		} finally {
			await Effect.runPromise(runtime.stop);
		}
	},
);
