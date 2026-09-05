import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { expect, test, vi } from "vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import {
	createAgentMessage,
	parseControllerMessage,
	type VolumeCommand,
	type VolumeCommandPayload,
	type VolumeCommandResponsePayload,
} from "@zerobyte/contracts/agent-protocol";
import { createAgentExecutionPolicy } from "../../../../../apps/agent/src/execution-policy";
import { createTrustedRootRegistry } from "../../../../../apps/agent/src/trusted-roots";
import type { AgentConnectionData } from "../controller/session";
import { backupVolume, createSocket, readyPayload, startRuntime } from "./controller-runtime.test-utils";

const data = {
	id: "connection-1",
	agentId: "agent-1",
	organizationId: "org-1",
	agentName: "Agent 1",
	agentKind: "remote",
	credentialVersion: 1,
} satisfies AgentConnectionData;

test("dispatches trusted filesystem commands from a remote policy without enabling managed volumes", async () => {
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime();
	const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-runtime-dispatch-"));
	try {
		const rawRoots = JSON.stringify([{ id: "data", label: "Data", path: rootPath }]);
		const trustedRootRegistry = createTrustedRootRegistry({ rawRoots });
		const executionPolicy = createAgentExecutionPolicy({
			builtinLocal: false,
			registry: trustedRootRegistry,
		});
		const capabilities = executionPolicy.capabilities;
		const socket = createSocket(data.id, data.agentId);
		const sentCommands: VolumeCommandPayload[] = [];
		socket.send.mockImplementation((text) => {
			const message = parseControllerMessage(text);
			if (!message?.success) throw new Error("Expected a valid controller message");
			if (message.data.type === "volume.command") sentCommands.push(message.data.payload);
			return 1;
		});
		await runtime.openConnection(data, { send: socket.send, close: socket.close });
		const ready = { ...readyPayload, agentId: data.agentId, capabilities };
		await runtime.handleConnectionMessage(data.agentId, data.id, createAgentMessage("agent.ready", ready));
		await expect(runtime.waitForAgentReady(data.agentId, 0)).resolves.toBe(true);
		const trustedReference = { rootId: "data", relativePath: "photos" };
		const trustedCommands = [
			{ name: "filesystem.browse", reference: trustedReference },
			{ name: "volume.statfs", source: { kind: "agent-filesystem", reference: trustedReference } },
			{
				name: "volume.listFiles",
				source: { kind: "agent-filesystem", reference: trustedReference },
				offset: 0,
				limit: 100,
			},
		] satisfies VolumeCommand[];
		const managedVolume = { ...backupVolume, agentId: data.agentId };
		const managedCommand = { name: "volume.mount", volume: managedVolume } satisfies VolumeCommand;

		expect(capabilities.volume).toBe(false);
		for (const command of trustedCommands) {
			const expectedCount = sentCommands.length + 1;
			const result = Effect.runPromise(runtime.runVolumeCommand(data.agentId, "org-1", command));
			await vi.waitFor(() => expect(sentCommands).toHaveLength(expectedCount));
			const sent = sentCommands.at(-1);
			if (!sent) throw new Error("Expected a volume command");
			expect(sent.command).toEqual(command);
			const response = {
				commandId: sent.commandId,
				status: "error",
				error: "expected test response",
			} satisfies VolumeCommandResponsePayload;
			await runtime.handleConnectionMessage(
				data.agentId,
				data.id,
				createAgentMessage("volume.commandResult", response),
			);
			await expect(result).resolves.toEqual(response);
		}
		await expect(
			Effect.runPromise(runtime.runVolumeCommand(data.agentId, "org-1", managedCommand)),
		).resolves.toBeNull();
		expect(sentCommands).toHaveLength(trustedCommands.length);
	} finally {
		await Effect.runPromise(runtime.stop);
		fs.rmSync(rootPath, { recursive: true, force: true });
	}
});
