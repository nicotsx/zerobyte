import { Effect } from "effect";
import { expect, test, vi } from "vitest";
import waitForExpect from "wait-for-expect";
import { fromPartial } from "@total-typescript/shoehorn";
import { createAgentMessage } from "@zerobyte/contracts/agent-protocol";
import { LOCAL_AGENT_ID } from "../constants";
import {
	backupPayload,
	createSocket,
	getAgentsServiceMocks,
	readyPayload,
	startRuntime,
} from "./controller-runtime.test-utils";

const agentsServiceMocks = getAgentsServiceMocks();

test("send failure cleans up even when transport close throws and no close callback arrives", async () => {
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime, onEvent } = await startRuntime(vi.fn());
	const socket = createSocket("connection-send-failure");
	await runtime.openConnection(socket.data, { send: socket.send, close: socket.close });
	await runtime.handleConnectionMessage(
		socket.data.agentId,
		socket.data.id,
		createAgentMessage("agent.ready", readyPayload),
	);
	socket.send.mockImplementation(() => {
		throw new Error("send failed");
	});
	socket.close.mockImplementation(() => {
		throw new Error("close failed");
	});

	await expect(Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(true);
	await waitForExpect(() => {
		expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledWith(LOCAL_AGENT_ID, expect.any(Number), 0);
		expect(onEvent).toHaveBeenCalledTimes(1);
		expect(onEvent).toHaveBeenCalledWith(
			expect.objectContaining({ type: "agent.disconnected", agentId: LOCAL_AGENT_ID }),
		);
	});

	await runtime.handleConnectionMessage(
		socket.data.agentId,
		socket.data.id,
		createAgentMessage("heartbeat.pong", { sentAt: 999 }),
	);
	expect(agentsServiceMocks.markAgentSeen).not.toHaveBeenCalled();
	await expect(Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(false);
	await Effect.runPromise(runtime.stop);
});

test("markAgentOnline failure terminates the current session and permits reconnect", async () => {
	agentsServiceMocks.markAgentOnline.mockRejectedValueOnce(new Error("db unavailable"));
	agentsServiceMocks.markAgentOffline.mockRejectedValueOnce(new Error("offline update unavailable"));
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime, onEvent } = await startRuntime(vi.fn());
	const socket = createSocket("connection-online-failure");
	await runtime.openConnection(socket.data, { send: socket.send, close: socket.close });

	await runtime.handleConnectionMessage(
		socket.data.agentId,
		socket.data.id,
		createAgentMessage("agent.ready", readyPayload),
	);
	await waitForExpect(() => {
		expect(socket.close).toHaveBeenCalledWith(1011, "inbound_processing_failed");
		expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledOnce();
		expect(onEvent).toHaveBeenCalledOnce();
		expect(onEvent).toHaveBeenCalledWith(
			expect.objectContaining({ type: "agent.disconnected", agentId: LOCAL_AGENT_ID }),
		);
	});

	await runtime.handleConnectionMessage(
		socket.data.agentId,
		socket.data.id,
		createAgentMessage("heartbeat.pong", { sentAt: 1 }),
	);
	expect(agentsServiceMocks.markAgentSeen).not.toHaveBeenCalled();
	await expect(runtime.waitForAgentReady(LOCAL_AGENT_ID, 1)).resolves.toBe(false);
	await expect(runtime.disconnectAgent(LOCAL_AGENT_ID)).resolves.toBe(false);
	await expect(Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(false);
	expect(socket.close).toHaveBeenCalledTimes(1);
	expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledTimes(1);
	expect(onEvent).toHaveBeenCalledTimes(1);

	const replacement = createSocket("connection-after-online-failure");
	await runtime.openConnection(replacement.data, { send: replacement.send, close: replacement.close });
	await runtime.handleConnectionMessage(
		replacement.data.agentId,
		replacement.data.id,
		createAgentMessage("agent.ready", readyPayload),
	);
	await expect(runtime.waitForAgentReady(LOCAL_AGENT_ID)).resolves.toBe(true);
	await expect(Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(true);
	await Effect.runPromise(runtime.stop);
});

test("markAgentSeen failure terminates the current session and permits reconnect", async () => {
	agentsServiceMocks.markAgentSeen.mockRejectedValueOnce(new Error("db unavailable"));
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime, onEvent } = await startRuntime(vi.fn());
	const socket = createSocket("connection-seen-failure");
	await runtime.openConnection(socket.data, { send: socket.send, close: socket.close });
	await runtime.handleConnectionMessage(
		socket.data.agentId,
		socket.data.id,
		createAgentMessage("agent.ready", readyPayload),
	);

	await runtime.handleConnectionMessage(
		socket.data.agentId,
		socket.data.id,
		createAgentMessage("heartbeat.pong", { sentAt: 1 }),
	);
	await waitForExpect(() => {
		expect(socket.close).toHaveBeenCalledWith(1011, "inbound_processing_failed");
		expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledOnce();
		expect(onEvent).toHaveBeenCalledOnce();
		expect(onEvent).toHaveBeenCalledWith(
			expect.objectContaining({ type: "agent.disconnected", agentId: LOCAL_AGENT_ID }),
		);
	});

	await runtime.handleConnectionMessage(
		socket.data.agentId,
		socket.data.id,
		createAgentMessage("heartbeat.pong", { sentAt: 2 }),
	);
	expect(agentsServiceMocks.markAgentSeen).toHaveBeenCalledTimes(1);
	await expect(runtime.waitForAgentReady(LOCAL_AGENT_ID, 1)).resolves.toBe(false);
	await expect(runtime.disconnectAgent(LOCAL_AGENT_ID)).resolves.toBe(false);
	await expect(Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(false);
	expect(socket.close).toHaveBeenCalledTimes(1);
	expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledTimes(1);
	expect(onEvent).toHaveBeenCalledTimes(1);

	const replacement = createSocket("connection-after-seen-failure");
	await runtime.openConnection(replacement.data, { send: replacement.send, close: replacement.close });
	await runtime.handleConnectionMessage(
		replacement.data.agentId,
		replacement.data.id,
		createAgentMessage("agent.ready", readyPayload),
	);
	await expect(runtime.waitForAgentReady(LOCAL_AGENT_ID)).resolves.toBe(true);
	await Effect.runPromise(runtime.stop);
});

test("operational event callback rejection terminates the current session without an unhandled rejection", async () => {
	const onEvent = vi.fn((event: { type: string }) => {
		if (event.type === "restore.completed") return Promise.reject(new Error("event handler failed"));
		return Promise.resolve();
	});
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime(onEvent);
	const socket = createSocket("connection-event-failure");
	await runtime.openConnection(socket.data, { send: socket.send, close: socket.close });
	await runtime.handleConnectionMessage(
		socket.data.agentId,
		socket.data.id,
		createAgentMessage("agent.ready", readyPayload),
	);
	onEvent.mockClear();
	const completed = createAgentMessage("restore.completed", {
		restoreId: "restore-failed",
		organizationId: "org-1",
		repositoryId: "repo-1",
		snapshotId: "snapshot-1",
		result: { message_type: "summary", files_restored: 1, files_skipped: 0 },
	});

	await runtime.handleConnectionMessage(socket.data.agentId, socket.data.id, completed);
	await waitForExpect(() => {
		expect(socket.close).toHaveBeenCalledWith(1011, "inbound_processing_failed");
		expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledOnce();
		expect(onEvent).toHaveBeenCalledTimes(2);
		expect(onEvent).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: "agent.disconnected", agentId: LOCAL_AGENT_ID }),
		);
	});

	await runtime.handleConnectionMessage(
		socket.data.agentId,
		socket.data.id,
		createAgentMessage("heartbeat.pong", { sentAt: 1 }),
	);
	expect(agentsServiceMocks.markAgentSeen).not.toHaveBeenCalled();
	await expect(runtime.waitForAgentReady(LOCAL_AGENT_ID, 1)).resolves.toBe(false);
	await expect(runtime.disconnectAgent(LOCAL_AGENT_ID)).resolves.toBe(false);
	await expect(Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(false);
	expect(socket.close).toHaveBeenCalledTimes(1);
	expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledTimes(1);
	expect(onEvent).toHaveBeenCalledTimes(2);

	const replacement = createSocket("connection-after-event-failure");
	await runtime.openConnection(replacement.data, { send: replacement.send, close: replacement.close });
	await runtime.handleConnectionMessage(
		replacement.data.agentId,
		replacement.data.id,
		createAgentMessage("agent.ready", readyPayload),
	);
	await expect(runtime.waitForAgentReady(LOCAL_AGENT_ID)).resolves.toBe(true);
	await Effect.runPromise(runtime.stop);
});
