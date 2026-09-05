import { Effect } from "effect";
import { expect, test, vi } from "vitest";
import waitForExpect from "wait-for-expect";
import { fromPartial } from "@total-typescript/shoehorn";
import { createAgentMessage } from "@zerobyte/contracts/agent-protocol";
import { LOCAL_AGENT_ID, LOCAL_AGENT_KIND, LOCAL_AGENT_NAME } from "../constants";
import {
	backupPayload,
	createSocket,
	getAgentsServiceMocks,
	getTokenMocks,
	invokeFetch,
	readyPayload,
	startRuntime,
} from "./controller-runtime.test-utils";

const agentsServiceMocks = getAgentsServiceMocks();
const tokenMocks = getTokenMocks();

test("websocket fetch rejects requests without a bearer token", async () => {
	const serve = vi
		.spyOn(Bun, "serve")
		.mockReturnValue(fromPartial({ port: 4567, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime();
	const fetch = serve.mock.calls[0]?.[0].fetch;
	const upgrade = vi.fn();
	const srv = fromPartial<Parameters<NonNullable<typeof fetch>>[1]>({ upgrade });

	const response = await invokeFetch(fetch, new Request("http://localhost:3001/agent"), srv);
	await Effect.runPromise(runtime.stop);

	expect(runtime.getControllerUrl()).toBeNull();
	expect(response?.status).toBe(401);
	expect(await response?.text()).toBe("Missing token");
	expect(upgrade).not.toHaveBeenCalled();
});

test("websocket fetch rejects invalid bearer tokens", async () => {
	tokenMocks.validateAgentToken.mockResolvedValue(undefined);
	const serve = vi
		.spyOn(Bun, "serve")
		.mockReturnValue(fromPartial({ port: 4567, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime();
	expect(runtime.getControllerUrl()).toBe("ws://127.0.0.1:4567");
	const fetch = serve.mock.calls[0]?.[0].fetch;
	const upgrade = vi.fn();
	const srv = fromPartial<Parameters<NonNullable<typeof fetch>>[1]>({ upgrade });

	const response = await invokeFetch(
		fetch,
		new Request("http://localhost:3001/agent", { headers: { authorization: "Bearer bad-token" } }),
		srv,
	);
	await Effect.runPromise(runtime.stop);

	expect(response?.status).toBe(401);
	expect(await response?.text()).toBe("Invalid or revoked token");
	expect(tokenMocks.validateAgentToken).toHaveBeenCalledWith("bad-token");
	expect(upgrade).not.toHaveBeenCalled();
});

test("websocket fetch upgrades valid agent tokens with connection metadata", async () => {
	tokenMocks.validateAgentToken.mockResolvedValue({
		agentId: LOCAL_AGENT_ID,
		organizationId: null,
		agentName: LOCAL_AGENT_NAME,
		agentKind: LOCAL_AGENT_KIND,
		credentialVersion: 0,
	});
	const serve = vi
		.spyOn(Bun, "serve")
		.mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime();
	const fetch = serve.mock.calls[0]?.[0].fetch;
	const upgrade = vi.fn(() => true);
	const srv = fromPartial<Parameters<NonNullable<typeof fetch>>[1]>({ upgrade });

	const response = await invokeFetch(
		fetch,
		new Request("http://localhost:3001/agent", { headers: { authorization: "Bearer valid-token" } }),
		srv,
	);
	await Effect.runPromise(runtime.stop);

	expect(response).toBeUndefined();
	expect(tokenMocks.validateAgentToken).toHaveBeenCalledWith("valid-token");
	expect(upgrade).toHaveBeenCalledWith(expect.any(Request), {
		data: expect.objectContaining({
			agentId: LOCAL_AGENT_ID,
			organizationId: null,
			agentName: LOCAL_AGENT_NAME,
			agentKind: LOCAL_AGENT_KIND,
			id: expect.any(String),
		}),
	});
});

test("shutdown fences an upgrade whose token validation began before the stop", async () => {
	let releaseValidation: (() => void) | undefined;
	const validationBlocked = new Promise<void>((resolve) => {
		releaseValidation = resolve;
	});
	tokenMocks.validateAgentToken.mockImplementation(async () => {
		await validationBlocked;
		return {
			agentId: LOCAL_AGENT_ID,
			organizationId: null,
			agentName: LOCAL_AGENT_NAME,
			agentKind: LOCAL_AGENT_KIND,
			credentialVersion: 0,
		};
	});
	const stopServer = vi.fn(() => Promise.resolve());
	const serve = vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: stopServer }));
	const { runtime } = await startRuntime();
	const fetch = serve.mock.calls[0]?.[0].fetch;
	const upgrade = vi.fn(() => true);
	const srv = fromPartial<Parameters<NonNullable<typeof fetch>>[1]>({ upgrade });
	const request = new Request("http://localhost:3001/agent", {
		headers: { authorization: "Bearer valid-token" },
	});
	const responsePromise = invokeFetch(fetch, request, srv);
	await waitForExpect(() => expect(tokenMocks.validateAgentToken).toHaveBeenCalledOnce());

	await Effect.runPromise(runtime.stop);
	releaseValidation?.();
	const response = await responsePromise;

	expect(response?.status).toBe(503);
	expect(upgrade).not.toHaveBeenCalled();
	expect(runtime.getLifecycle()).toBe("stopped");
	expect(stopServer).toHaveBeenCalledOnce();
});

test("websocket lifecycle updates agent connection status", async () => {
	const stop = vi.fn(() => Promise.resolve());
	const serve = vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop }));
	const { runtime } = await startRuntime();
	const websocket = serve.mock.calls[0]?.[0].websocket;
	const socket = createSocket("connection-1");

	await websocket?.open?.(fromPartial(socket));
	await websocket?.message?.(fromPartial(socket), createAgentMessage("agent.ready", readyPayload));
	await websocket?.message?.(fromPartial(socket), createAgentMessage("heartbeat.pong", { sentAt: 123 }));
	await websocket?.close?.(fromPartial(socket), 1000, "done");
	await Effect.runPromise(runtime.stop);

	expect(agentsServiceMocks.markAgentConnecting).toHaveBeenCalledWith({
		agentId: LOCAL_AGENT_ID,
		organizationId: null,
		agentName: LOCAL_AGENT_NAME,
		agentKind: LOCAL_AGENT_KIND,
		credentialVersion: 0,
	});
	expect(agentsServiceMocks.markAgentOnline).toHaveBeenCalledWith(
		LOCAL_AGENT_ID,
		expect.any(Number),
		expect.objectContaining({
			backup: true,
			protocolVersion: 1,
			protocolCompatible: true,
			hostname: "host",
			platform: "linux",
		}),
		0,
	);
	expect(agentsServiceMocks.markAgentSeen).toHaveBeenCalledWith(LOCAL_AGENT_ID, expect.any(Number), 0);
	expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledWith(LOCAL_AGENT_ID, expect.any(Number), 0);
	expect(stop).toHaveBeenCalledWith(false);
});

test("websocket protocol rejection forwards the event and closes the connection", async () => {
	const serve = vi
		.spyOn(Bun, "serve")
		.mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime, onEvent } = await startRuntime(vi.fn());
	const websocket = serve.mock.calls[0]?.[0].websocket;
	const socket = createSocket("connection-1");

	await websocket?.open?.(fromPartial(socket));
	await websocket?.message?.(
		fromPartial(socket),
		JSON.stringify({
			type: "agent.ready",
			payload: {
				protocolVersion: 2,
				hostname: "host",
				platform: "linux",
			},
		}),
	);
	await Effect.runPromise(runtime.stop);

	expect(onEvent).toHaveBeenCalledWith(
		expect.objectContaining({
			type: "agent.protocolRejected",
			agentId: LOCAL_AGENT_ID,
			agentName: LOCAL_AGENT_NAME,
			payload: expect.objectContaining({ reason: "agent_too_new" }),
		}),
	);
	await waitForExpect(() => {
		expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledWith(LOCAL_AGENT_ID, expect.any(Number), 0);
	});
	expect(socket.close).toHaveBeenCalledWith(1002, "agent_too_new");
});

test("websocket restore events are forwarded with agent metadata", async () => {
	const serve = vi
		.spyOn(Bun, "serve")
		.mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime, onEvent } = await startRuntime(vi.fn());
	const websocket = serve.mock.calls[0]?.[0].websocket;
	const socket = createSocket("connection-1");

	await websocket?.open?.(fromPartial(socket));
	await websocket?.message?.(fromPartial(socket), createAgentMessage("agent.ready", readyPayload));
	onEvent.mockClear();
	await websocket?.message?.(
		fromPartial(socket),
		createAgentMessage("restore.completed", {
			restoreId: "restore-1",
			organizationId: "org-1",
			repositoryId: "repo-1",
			snapshotId: "snapshot-1",
			result: { message_type: "summary", files_restored: 2, files_skipped: 0 },
		}),
	);
	await Effect.runPromise(runtime.stop);

	expect(onEvent).toHaveBeenCalledWith(
		expect.objectContaining({
			type: "restore.completed",
			agentId: LOCAL_AGENT_ID,
			agentName: LOCAL_AGENT_NAME,
			payload: expect.objectContaining({ restoreId: "restore-1" }),
		}),
	);
});

test("websocket open failure clears provisional state and permits reconnect", async () => {
	agentsServiceMocks.markAgentConnecting.mockRejectedValueOnce(new Error("db unavailable"));
	const serve = vi
		.spyOn(Bun, "serve")
		.mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime();
	const websocket = serve.mock.calls[0]?.[0].websocket;
	const socket = createSocket("connection-1");

	await websocket?.open?.(fromPartial(socket));

	expect(socket.close).toHaveBeenCalledWith(1011, "promotion_failed");
	const replacement = createSocket("connection-after-open-failure");
	await websocket?.open?.(fromPartial(replacement));
	await websocket?.message?.(fromPartial(replacement), createAgentMessage("agent.ready", readyPayload));
	await expect(runtime.waitForAgentReady(LOCAL_AGENT_ID)).resolves.toBe(true);
	await Effect.runPromise(runtime.stop);
});

test("replacement connecting failure terminal-cleans both promoted and replaced generations", async () => {
	agentsServiceMocks.markAgentConnecting
		.mockResolvedValueOnce(undefined)
		.mockRejectedValueOnce(new Error("db unavailable"));
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime();
	const oldSocket = createSocket("connection-old");
	const newSocket = createSocket("connection-new");
	await runtime.openConnection(oldSocket.data, { send: oldSocket.send, close: oldSocket.close });
	await runtime.handleConnectionMessage(
		oldSocket.data.agentId,
		oldSocket.data.id,
		createAgentMessage("agent.ready", readyPayload),
	);

	await expect(
		runtime.openConnection(newSocket.data, { send: newSocket.send, close: newSocket.close }),
	).rejects.toThrow("db unavailable");
	expect(newSocket.close).toHaveBeenCalledWith(1011, "promotion_failed");
	expect(oldSocket.close).toHaveBeenCalledWith(1000, "connection_replaced");
	await expect(Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(false);
	await Effect.runPromise(runtime.stop);
});

test("shutdown contains cleanup failures, closes every session, and stops the server once", async () => {
	agentsServiceMocks.markAgentOffline.mockRejectedValueOnce(new Error("db unavailable"));
	const stop = vi.fn(() => Promise.resolve());
	const serve = vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop }));
	const onEvent = vi.fn((event: { type: string; agentId?: string }) => {
		if (event.type === "agent.disconnected" && event.agentId === "agent-1") {
			return Promise.reject(new Error("disconnect callback failed"));
		}
		return Promise.resolve();
	});
	const { runtime } = await startRuntime(onEvent);
	const websocket = serve.mock.calls[0]?.[0].websocket;
	const firstSocket = createSocket("connection-1", "agent-1");
	const secondSocket = createSocket("connection-2", "agent-2");

	await websocket?.open?.(fromPartial(firstSocket));
	await websocket?.open?.(fromPartial(secondSocket));
	firstSocket.close.mockImplementation(() => {
		throw new Error("close failed");
	});
	await expect(Effect.runPromise(runtime.stop)).resolves.toBeUndefined();

	expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledWith("agent-1", expect.any(Number), 0);
	expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledWith("agent-2", expect.any(Number), 0);
	expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "agent.disconnected", agentId: "agent-1" }));
	expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "agent.disconnected", agentId: "agent-2" }));
	expect(firstSocket.close).toHaveBeenCalledWith(1000, "controller_shutdown");
	expect(secondSocket.close).toHaveBeenCalledWith(1000, "controller_shutdown");
	expect(stop).toHaveBeenCalledOnce();
	expect(stop).toHaveBeenCalledWith(false);
});

test("closing a replaced connection reports disconnect without marking the active agent offline", async () => {
	const serve = vi
		.spyOn(Bun, "serve")
		.mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime, onEvent } = await startRuntime(vi.fn());
	const websocket = serve.mock.calls[0]?.[0].websocket;
	const oldSocket = createSocket("connection-1");
	const newSocket = createSocket("connection-2");

	await websocket?.open?.(fromPartial(oldSocket));
	await websocket?.open?.(fromPartial(newSocket));
	await websocket?.message?.(fromPartial(newSocket), createAgentMessage("agent.ready", readyPayload));
	const offlineCallsBeforeClose = agentsServiceMocks.markAgentOffline.mock.calls.length;
	await websocket?.close?.(fromPartial(oldSocket), 1000, "replaced");

	expect(onEvent).toHaveBeenCalledWith(
		expect.objectContaining({ type: "agent.disconnected", agentId: LOCAL_AGENT_ID }),
	);
	expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledTimes(offlineCallsBeforeClose);
	expect(await Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, backupPayload))).toBe(true);
	await Effect.runPromise(runtime.stop);
});
