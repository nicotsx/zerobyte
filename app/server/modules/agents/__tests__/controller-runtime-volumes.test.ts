import { Effect } from "effect";
import { expect, test, vi } from "vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { createAgentMessage, parseControllerMessage, type VolumeCommand } from "@zerobyte/contracts/agent-protocol";
import { LOCAL_AGENT_ID } from "../constants";
import { backupVolume, createSocket, readyPayload, startRuntime } from "./controller-runtime.test-utils";

const volumeCommand = { name: "volume.mount", volume: backupVolume } satisfies VolumeCommand;

const sentVolumeCommand = (socket: ReturnType<typeof createSocket>) => {
	for (const [text] of socket.send.mock.calls) {
		const message = parseControllerMessage(text);
		if (message?.success && message.data.type === "volume.command") return message.data.payload;
	}
	throw new Error("Expected a volume command");
};

test.each(["disconnect", "shutdown"] as const)("%s rejects an unanswered volume request", async (action) => {
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime();
	try {
		const socket = createSocket("connection-pending-volume");
		await runtime.openConnection(socket.data, { send: socket.send, close: socket.close });
		await runtime.handleConnectionMessage(
			socket.data.agentId,
			socket.data.id,
			createAgentMessage("agent.ready", readyPayload),
		);
		const result = Effect.runPromise(runtime.runVolumeCommand(LOCAL_AGENT_ID, "org-1", volumeCommand));
		const rejection = expect(result).rejects.toThrow(
			"Agent session closed before volume command volume.mount completed",
		);
		await vi.waitFor(() => expect(sentVolumeCommand(socket).command).toEqual(volumeCommand));

		if (action === "disconnect") {
			await expect(runtime.disconnectAgent(LOCAL_AGENT_ID)).resolves.toBe(true);
		} else {
			await Effect.runPromise(runtime.stop);
		}
		await rejection;
		await expect(runtime.waitForAgentReady(LOCAL_AGENT_ID, 0)).resolves.toBe(false);
	} finally {
		await Effect.runPromise(runtime.stop);
	}
});

test("an old connection cannot complete the replacement connection's volume request", async () => {
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime();
	try {
		const oldSocket = createSocket("connection-volume-old");
		const newSocket = createSocket("connection-volume-new");
		for (const socket of [oldSocket, newSocket]) {
			await runtime.openConnection(socket.data, { send: socket.send, close: socket.close });
			await runtime.handleConnectionMessage(
				socket.data.agentId,
				socket.data.id,
				createAgentMessage("agent.ready", readyPayload),
			);
		}
		const result = Effect.runPromise(runtime.runVolumeCommand(LOCAL_AGENT_ID, "org-1", volumeCommand));
		const settled = vi.fn();
		void result.then(settled, settled);
		await vi.waitFor(() => expect(sentVolumeCommand(newSocket).command).toEqual(volumeCommand));
		const commandId = sentVolumeCommand(newSocket).commandId;
		const staleResult = createAgentMessage("volume.commandResult", {
			commandId,
			status: "error",
			error: "stale connection result",
		});
		await expect(
			runtime.handleConnectionMessage(oldSocket.data.agentId, oldSocket.data.id, staleResult),
		).resolves.toBe(false);
		expect(settled).not.toHaveBeenCalled();

		const response = { commandId, status: "error" as const, error: "current connection result" };
		await runtime.handleConnectionMessage(
			newSocket.data.agentId,
			newSocket.data.id,
			createAgentMessage("volume.commandResult", response),
		);
		await expect(result).resolves.toEqual(response);
	} finally {
		await Effect.runPromise(runtime.stop);
	}
});
