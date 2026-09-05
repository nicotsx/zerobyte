import { Effect } from "effect";
import { expect, test, vi } from "vitest";
import waitForExpect from "wait-for-expect";
import { fromPartial } from "@total-typescript/shoehorn";
import { createAgentMessage, type RestoreRunPayload, type VolumeCommand } from "@zerobyte/contracts/agent-protocol";
import { LOCAL_AGENT_ID } from "../constants";
import {
	backupPayload,
	backupVolume,
	createSocket,
	getAgentsServiceMocks,
	readyPayload,
	startRuntime,
} from "./controller-runtime.test-utils";

const agentsServiceMocks = getAgentsServiceMocks();

test("sendBackup is only delivered after the agent is ready", async () => {
	const serve = vi
		.spyOn(Bun, "serve")
		.mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime();
	const websocket = serve.mock.calls[0]?.[0].websocket;
	const socket = createSocket("connection-1");
	const payload = backupPayload;

	await websocket?.open?.(fromPartial(socket));
	await expect(Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, payload))).resolves.toBe(false);

	await websocket?.message?.(fromPartial(socket), createAgentMessage("agent.ready", readyPayload));
	await expect(Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, payload))).resolves.toBe(true);

	await waitForExpect(() => {
		expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"backup.run"'));
	});
	await Effect.runPromise(runtime.stop);
});

test("remote restore is rejected before it reaches the transport", async () => {
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime();
	const send = vi.fn(() => 1);
	const close = vi.fn();
	const data = {
		id: "remote-connection",
		agentId: "remote-agent",
		organizationId: "org-1",
		agentName: "Remote Agent",
		agentKind: "remote" as const,
		credentialVersion: 1,
	};
	await runtime.openConnection(data, { send, close });
	const ready = { ...readyPayload, agentId: data.agentId };
	await runtime.handleConnectionMessage(data.agentId, data.id, createAgentMessage("agent.ready", ready));

	const restore = fromPartial<RestoreRunPayload>({ restoreId: "restore-1", organizationId: "org-1" });
	await expect(Effect.runPromise(runtime.sendRestore(data.agentId, restore))).resolves.toBe(false);
	expect(send).not.toHaveBeenCalledWith(expect.stringContaining('"type":"restore.run"'));
	await Effect.runPromise(runtime.stop);
});

test("outbound admission rejects capability and organization mismatches for commands and cancels", async () => {
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime();
	const socket = createSocket("remote-capability-connection", "remote-capability-agent");
	const data = { ...socket.data, organizationId: "org-1", agentKind: "remote" as const };
	await runtime.openConnection(data, { send: socket.send, close: socket.close });
	const ready = {
		...readyPayload,
		agentId: data.agentId,
		capabilities: { backup: false, restore: false, volume: false },
	};
	await runtime.handleConnectionMessage(data.agentId, data.id, createAgentMessage("agent.ready", ready));
	const wrongOrganizationBackup = { ...backupPayload, organizationId: "org-2" };
	const volumeCommand = fromPartial<VolumeCommand>({ name: "volume.mount", volume: backupVolume });

	await expect(Effect.runPromise(runtime.sendBackup(data.agentId, wrongOrganizationBackup))).resolves.toBe(false);
	await expect(
		Effect.runPromise(
			runtime.cancelBackup(data.agentId, { jobId: backupPayload.jobId, scheduleId: backupPayload.scheduleId }),
		),
	).resolves.toBe(false);
	await expect(Effect.runPromise(runtime.runVolumeCommand(data.agentId, "org-2", volumeCommand))).resolves.toBeNull();
	expect(socket.send).not.toHaveBeenCalledWith(expect.stringMatching(/"type":"(backup|volume)\./));
	await Effect.runPromise(runtime.stop);
});

test("admission gates are reused concurrently and released after agent state is gone", async () => {
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime();
	const baseline = runtime.getAgentCount();
	const nonexistentAdmissions = Array.from({ length: 100 }, (_, index) => {
		const agentId = `missing-agent-${index}`;
		return Effect.runPromise(runtime.sendBackup(agentId, backupPayload));
	});
	const sharedAgentAdmissions = Array.from({ length: 100 }, () =>
		Effect.runPromise(runtime.sendBackup("missing-shared-agent", backupPayload)),
	);
	const results = await Promise.all([...nonexistentAdmissions, ...sharedAgentAdmissions]);

	expect(results.every((result) => result === false)).toBe(true);
	expect(runtime.getAgentCount()).toBe(baseline);

	const socket = createSocket("gate-lifetime-connection", "gate-lifetime-agent");
	await runtime.openConnection(socket.data, { send: socket.send, close: socket.close });
	expect(runtime.getAgentCount()).toBe(baseline + 1);
	await runtime.closeConnection(socket.data.agentId, socket.data.id);
	expect(runtime.getAgentCount()).toBe(baseline);
	await Effect.runPromise(runtime.stop);
});

test("concurrent promotion callers for one opening serialize on one gate", async () => {
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime();
	const socket = createSocket("concurrent-promotion", "concurrent-agent");
	runtime.beginOpeningConnection(socket.data, { send: socket.send, close: socket.close });
	const firstPromotion = runtime.promoteOpeningConnection(socket.data.agentId, socket.data.id);
	const secondPromotion = runtime.promoteOpeningConnection(socket.data.agentId, socket.data.id);
	const results = await Promise.all([firstPromotion, secondPromotion]);

	expect(results.filter(Boolean)).toHaveLength(1);
	expect(agentsServiceMocks.markAgentConnecting).toHaveBeenCalledOnce();
	expect(runtime.getAgentCount()).toBe(1);
	await runtime.closeConnection(socket.data.agentId, socket.data.id);
	expect(runtime.getAgentCount()).toBe(0);
	await Effect.runPromise(runtime.stop);
});

test("buffers startup messages until connection registration completes", async () => {
	let resolveRegistration: (() => void) | undefined;
	const registration = new Promise<void>((resolve) => {
		resolveRegistration = resolve;
	});
	agentsServiceMocks.markAgentConnecting.mockReturnValueOnce(registration);
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime();
	const socket = createSocket("connection-1");
	const open = runtime.openConnection(socket.data, { send: socket.send, close: socket.close });
	await waitForExpect(() => expect(agentsServiceMocks.markAgentConnecting).toHaveBeenCalledOnce());

	await runtime.handleConnectionMessage(
		socket.data.agentId,
		socket.data.id,
		createAgentMessage("agent.ready", readyPayload),
	);
	resolveRegistration?.();
	await open;

	await expect(Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(true);
	await Effect.runPromise(runtime.stop);
});

test("disconnects a connection that is still registering without activating it later", async () => {
	let resolveRegistration: (() => void) | undefined;
	const registration = new Promise<void>((resolve) => {
		resolveRegistration = resolve;
	});
	agentsServiceMocks.markAgentConnecting.mockReturnValueOnce(registration);
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime();
	const socket = createSocket("connection-1");
	const open = runtime.openConnection(socket.data, { send: socket.send, close: socket.close });
	await waitForExpect(() => expect(agentsServiceMocks.markAgentConnecting).toHaveBeenCalledOnce());

	const disconnect = runtime.disconnectAgent(socket.data.agentId);
	resolveRegistration?.();
	await expect(disconnect).resolves.toBe(true);
	await expect(open).resolves.toBe(false);

	expect(socket.close).toHaveBeenCalledWith(1000, "disconnected_by_controller");
	await expect(Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(false);
	await Effect.runPromise(runtime.stop);
});

test("replacement drains every admitted old ingress side effect before swapping authority", async () => {
	let releaseBackupEvent: (() => void) | undefined;
	const blockedBackupEvent = new Promise<void>((resolve) => {
		releaseBackupEvent = resolve;
	});
	const appliedEvents: string[] = [];
	const onEvent = vi.fn(async (event: { type: string }) => {
		if (event.type === "backup.completed") await blockedBackupEvent;
		if (event.type === "backup.completed" || event.type === "restore.completed") appliedEvents.push(event.type);
	});
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime(onEvent);
	const oldSocket = createSocket("connection-draining-old");
	const newSocket = createSocket("connection-draining-new");
	await runtime.openConnection(oldSocket.data, { send: oldSocket.send, close: oldSocket.close });
	await runtime.handleConnectionMessage(
		oldSocket.data.agentId,
		oldSocket.data.id,
		createAgentMessage("agent.ready", readyPayload),
	);
	const volumeCommand = fromPartial<VolumeCommand>({ name: "volume.mount", volume: backupVolume });
	const volumeResult = Effect.runPromise(runtime.runVolumeCommand(LOCAL_AGENT_ID, "org-1", volumeCommand));
	await waitForExpect(() =>
		expect(oldSocket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"volume.command"')),
	);
	const commandMessage = oldSocket.send.mock.calls
		.map(([message]) => JSON.parse(message as string) as { type: string; payload: { commandId: string } })
		.find((message) => message.type === "volume.command");
	if (!commandMessage) throw new Error("Expected volume command");

	const backupCompletion = runtime.handleConnectionMessage(
		oldSocket.data.agentId,
		oldSocket.data.id,
		createAgentMessage("backup.completed", {
			jobId: backupPayload.jobId,
			scheduleId: backupPayload.scheduleId,
			exitCode: 0,
			result: null,
		}),
	);
	await waitForExpect(() =>
		expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "backup.completed" })),
	);
	const restoreCompletion = runtime.handleConnectionMessage(
		oldSocket.data.agentId,
		oldSocket.data.id,
		createAgentMessage("restore.completed", {
			restoreId: "restore-drained",
			organizationId: "org-1",
			repositoryId: "repo-1",
			snapshotId: "snapshot-1",
			result: { message_type: "summary", files_restored: 1, files_skipped: 0 },
		}),
	);
	const volumeCompletion = runtime.handleConnectionMessage(
		oldSocket.data.agentId,
		oldSocket.data.id,
		createAgentMessage("volume.commandResult", {
			commandId: commandMessage.payload.commandId,
			status: "error",
			error: "drained",
		}),
	);
	const promotion = runtime.openConnection(newSocket.data, { send: newSocket.send, close: newSocket.close });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(agentsServiceMocks.markAgentConnecting).toHaveBeenCalledTimes(1);
	await expect(
		runtime.handleConnectionMessage(
			oldSocket.data.agentId,
			oldSocket.data.id,
			createAgentMessage("heartbeat.pong", { sentAt: 999 }),
		),
	).resolves.toBe(false);
	expect(oldSocket.close).not.toHaveBeenCalled();
	await expect(
		runtime.handleConnectionMessage(
			newSocket.data.agentId,
			newSocket.data.id,
			createAgentMessage("agent.ready", readyPayload),
		),
	).resolves.toBe(true);
	const restorePayload = fromPartial<RestoreRunPayload>({
		restoreId: "restore-after-swap",
		organizationId: "org-1",
		repositoryId: "repo-1",
		snapshotId: "snapshot-1",
		target: "/tmp/restore",
		repositoryConfig: { backend: "local", path: "/tmp/repository" },
		runtime: { password: "password" },
		options: { organizationId: "org-1" },
	});
	const outboundAdmissions = [
		Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, backupPayload)),
		Effect.runPromise(
			runtime.cancelBackup(LOCAL_AGENT_ID, {
				jobId: backupPayload.jobId,
				scheduleId: backupPayload.scheduleId,
			}),
		),
		Effect.runPromise(runtime.sendRestore(LOCAL_AGENT_ID, restorePayload)),
		Effect.runPromise(runtime.cancelRestore(LOCAL_AGENT_ID, { restoreId: restorePayload.restoreId })),
	];
	const blockedVolumePromise = Effect.runPromise(runtime.runVolumeCommand(LOCAL_AGENT_ID, "org-1", volumeCommand));
	const oldSendCount = oldSocket.send.mock.calls.length;

	releaseBackupEvent?.();
	const outboundResults = await Promise.all(outboundAdmissions);
	const blockedVolume = await blockedVolumePromise;
	await Promise.all([backupCompletion, restoreCompletion, volumeCompletion, promotion]);
	expect(outboundResults).toEqual([false, false, false, false]);
	expect(blockedVolume).toBeNull();
	await expect(volumeResult).resolves.toEqual(expect.objectContaining({ error: "drained" }));
	await expect(Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(true);
	const newVolume = Effect.runPromise(runtime.runVolumeCommand(LOCAL_AGENT_ID, "org-1", volumeCommand));
	await waitForExpect(() =>
		expect(newSocket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"volume.command"')),
	);
	const newCommandMessage = newSocket.send.mock.calls
		.map(([message]) => JSON.parse(message as string) as { type: string; payload: { commandId: string } })
		.find((message) => message.type === "volume.command");
	if (!newCommandMessage) throw new Error("Expected promoted volume command");
	await runtime.handleConnectionMessage(
		newSocket.data.agentId,
		newSocket.data.id,
		createAgentMessage("volume.commandResult", {
			commandId: newCommandMessage.payload.commandId,
			status: "error",
			error: "new",
		}),
	);
	await expect(newVolume).resolves.toEqual(expect.objectContaining({ error: "new" }));
	expect(oldSocket.send).toHaveBeenCalledTimes(oldSendCount);
	for (const type of ["backup.run", "volume.command"]) {
		expect(newSocket.send).toHaveBeenCalledWith(expect.stringContaining(`"type":"${type}"`));
	}
	expect(appliedEvents).toEqual(["backup.completed", "restore.completed"]);
	const restoreCall = onEvent.mock.calls.findIndex(([event]) => event.type === "restore.completed");
	const closeCall = oldSocket.close.mock.invocationCallOrder[0];
	const restoreInvocation = onEvent.mock.invocationCallOrder[restoreCall];
	expect(restoreInvocation).toBeLessThan(closeCall ?? Number.POSITIVE_INFINITY);
	await Effect.runPromise(runtime.stop);
});

test("promotion releases admission while connecting and enables outbound only after buffered ready", async () => {
	let resolveReplacementRegistration: (() => void) | undefined;
	const replacementRegistration = new Promise<void>((resolve) => {
		resolveReplacementRegistration = resolve;
	});
	const statusOrder: string[] = [];
	agentsServiceMocks.markAgentConnecting.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
		await replacementRegistration;
		statusOrder.push("connecting");
	});
	agentsServiceMocks.markAgentOnline.mockImplementation(async () => {
		statusOrder.push("online");
	});
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime(vi.fn());
	const oldSocket = createSocket("connection-old");
	const newSocket = createSocket("connection-new");
	await runtime.openConnection(oldSocket.data, { send: oldSocket.send, close: oldSocket.close });
	await runtime.handleConnectionMessage(
		oldSocket.data.agentId,
		oldSocket.data.id,
		createAgentMessage("agent.ready", readyPayload),
	);
	statusOrder.length = 0;

	const replacement = runtime.openConnection(newSocket.data, { send: newSocket.send, close: newSocket.close });
	await waitForExpect(() => expect(agentsServiceMocks.markAgentConnecting).toHaveBeenCalledTimes(2));
	expect(oldSocket.close).toHaveBeenCalledWith(1000, "connection_replaced");
	await expect(Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(false);
	expect(oldSocket.send).not.toHaveBeenCalledWith(expect.stringContaining('"type":"backup.run"'));
	expect(newSocket.send).not.toHaveBeenCalledWith(expect.stringContaining('"type":"backup.run"'));

	const laterSocket = createSocket("connection-later");
	runtime.beginOpeningConnection(laterSocket.data, { send: laterSocket.send, close: laterSocket.close });
	await expect(runtime.promoteOpeningConnection(laterSocket.data.agentId, laterSocket.data.id)).resolves.toBe(false);
	expect(laterSocket.close).toHaveBeenCalledWith(1000, "connection_replaced");

	await expect(
		runtime.handleConnectionMessage(
			newSocket.data.agentId,
			newSocket.data.id,
			createAgentMessage("agent.ready", readyPayload),
		),
	).resolves.toBe(true);
	resolveReplacementRegistration?.();
	await expect(replacement).resolves.toBe(true);
	expect(oldSocket.close).toHaveBeenCalledWith(1000, "connection_replaced");
	expect(statusOrder).toEqual(["connecting", "online"]);
	await expect(Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(true);
	expect(newSocket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"backup.run"'));
	await Effect.runPromise(runtime.stop);
});

test("active message count overflow is nonblocking, cleans up, and permits reconnect", async () => {
	let resolveSeen: (() => void) | undefined;
	const delayedSeen = new Promise<void>((resolve) => {
		resolveSeen = resolve;
	});
	agentsServiceMocks.markAgentSeen.mockReturnValueOnce(delayedSeen);
	const serve = vi
		.spyOn(Bun, "serve")
		.mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime();
	const websocket = serve.mock.calls[0]?.[0].websocket;
	const socket = createSocket("connection-count-limit");
	await websocket?.open?.(fromPartial(socket));
	await websocket?.message?.(fromPartial(socket), createAgentMessage("agent.ready", readyPayload));
	await expect(runtime.waitForAgentReady(LOCAL_AGENT_ID)).resolves.toBe(true);

	const pong = createAgentMessage("heartbeat.pong", { sentAt: 1 });
	await websocket?.message?.(fromPartial(socket), pong);
	await waitForExpect(() => expect(agentsServiceMocks.markAgentSeen).toHaveBeenCalledOnce());
	const exactLimitAdmissions = Array.from({ length: 64 }, () => websocket?.message?.(fromPartial(socket), pong));
	await Promise.all(exactLimitAdmissions);
	expect(socket.close).not.toHaveBeenCalledWith(1009, "active_message_limit");

	await websocket?.message?.(fromPartial(socket), pong);
	expect(socket.close).toHaveBeenCalledWith(1009, "active_message_limit");
	resolveSeen?.();
	await waitForExpect(() => {
		expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledWith(LOCAL_AGENT_ID, expect.any(Number), 0);
	});

	const replacement = createSocket("connection-after-overflow");
	await websocket?.open?.(fromPartial(replacement));
	await websocket?.message?.(fromPartial(replacement), createAgentMessage("agent.ready", readyPayload));
	await expect(runtime.waitForAgentReady(LOCAL_AGENT_ID)).resolves.toBe(true);
	await Effect.runPromise(runtime.stop);
});

test("active message byte limit accepts the exact limit and rejects the next byte", async () => {
	let resolveSeen: (() => void) | undefined;
	const delayedSeen = new Promise<void>((resolve) => {
		resolveSeen = resolve;
	});
	agentsServiceMocks.markAgentSeen.mockReturnValueOnce(delayedSeen);
	const serve = vi
		.spyOn(Bun, "serve")
		.mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime();
	const websocket = serve.mock.calls[0]?.[0].websocket;
	const socket = createSocket("connection-byte-limit");
	await websocket?.open?.(fromPartial(socket));
	await websocket?.message?.(fromPartial(socket), createAgentMessage("agent.ready", readyPayload));
	await expect(runtime.waitForAgentReady(LOCAL_AGENT_ID)).resolves.toBe(true);

	const pong = createAgentMessage("heartbeat.pong", { sentAt: 1 });
	await websocket?.message?.(fromPartial(socket), pong);
	await waitForExpect(() => expect(agentsServiceMocks.markAgentSeen).toHaveBeenCalledOnce());
	const exactByteLimitMessage = "x".repeat(1024 * 1024);
	await websocket?.message?.(fromPartial(socket), exactByteLimitMessage);
	expect(socket.close).not.toHaveBeenCalledWith(1009, "active_message_limit");

	await websocket?.message?.(fromPartial(socket), "x");
	expect(socket.close).toHaveBeenCalledWith(1009, "active_message_limit");
	resolveSeen?.();
	await waitForExpect(() => {
		expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledWith(LOCAL_AGENT_ID, expect.any(Number), 0);
	});
	await Effect.runPromise(runtime.stop);
});
