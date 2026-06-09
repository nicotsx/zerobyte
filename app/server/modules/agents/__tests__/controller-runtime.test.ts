import { Effect } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import waitForExpect from "wait-for-expect";
import WebSocket from "ws";
import { createAgentMessage } from "@zerobyte/contracts/agent-protocol";
import { webSocketRawDataToString } from "@zerobyte/core/node";
import type { Volume } from "@zerobyte/contracts/volumes";
import { LOCAL_AGENT_ID, LOCAL_AGENT_KIND, LOCAL_AGENT_NAME } from "../constants";

const agentsServiceMocks = vi.hoisted(() => ({
	markAgentConnecting: vi.fn(() => Promise.resolve()),
	markAgentOnline: vi.fn(() => Promise.resolve()),
	markAgentSeen: vi.fn(() => Promise.resolve()),
	markAgentOffline: vi.fn(() => Promise.resolve()),
}));

const tokenMocks = vi.hoisted(() => ({
	validateAgentToken: vi.fn(),
}));

vi.mock("../agents.service", () => ({
	agentsService: agentsServiceMocks,
}));

vi.mock("../helpers/tokens", () => ({
	validateAgentToken: tokenMocks.validateAgentToken,
}));

const backupVolume = {
	id: 1,
	shortId: "volume-1",
	name: "Volume 1",
	config: { backend: "directory", path: "/tmp" },
	createdAt: 0,
	updatedAt: 0,
	lastHealthCheck: 0,
	type: "directory",
	status: "mounted" as const,
	lastError: null,
	autoRemount: true,
	agentId: LOCAL_AGENT_ID,
	organizationId: "org-1",
} satisfies Volume;

const readyPayload = {
	agentId: LOCAL_AGENT_ID,
	protocolVersion: 1,
	hostname: "host",
	platform: "linux",
	capabilities: { backup: true },
};

const backupPayload = {
	jobId: "job-1",
	scheduleId: "schedule-1",
	organizationId: "org-1",
	volume: backupVolume,
	repositoryConfig: { backend: "local" as const, path: "/tmp/repository" },
	options: {
		oneFileSystem: false,
		excludePatterns: null,
		excludeIfPresent: null,
		includePaths: null,
		includePatterns: null,
		customResticParams: null,
		compressionMode: "auto" as const,
	},
	runtime: { password: "password" },
	webhooks: { pre: null, post: null },
	webhookAllowedOrigins: [],
	webhookTimeoutMs: 60_000,
};

type RuntimeHandle = {
	stop: Effect.Effect<void>;
	getControllerUrl: () => string | null;
};

type TestAgentConnection = {
	ws: WebSocket;
	messages: string[];
	closed: Promise<{ code: number; reason: string }>;
	isClosed: boolean;
};

const activeRuntimes: RuntimeHandle[] = [];
const activeAgents: TestAgentConnection[] = [];

const defaultTokenResult = (agentId = LOCAL_AGENT_ID) => ({
	agentId,
	organizationId: null,
	agentName: agentId === LOCAL_AGENT_ID ? LOCAL_AGENT_NAME : `${LOCAL_AGENT_NAME} ${agentId}`,
	agentKind: LOCAL_AGENT_KIND,
});

const resetAgentsServiceMocks = () => {
	agentsServiceMocks.markAgentConnecting.mockReset();
	agentsServiceMocks.markAgentOnline.mockReset();
	agentsServiceMocks.markAgentSeen.mockReset();
	agentsServiceMocks.markAgentOffline.mockReset();

	agentsServiceMocks.markAgentConnecting.mockResolvedValue(undefined);
	agentsServiceMocks.markAgentOnline.mockResolvedValue(undefined);
	agentsServiceMocks.markAgentSeen.mockResolvedValue(undefined);
	agentsServiceMocks.markAgentOffline.mockResolvedValue(undefined);
};

const startRuntime = async (onEvent = vi.fn()) => {
	const { createAgentManagerRuntime } = await import("../controller/server");
	const runtime = createAgentManagerRuntime(onEvent);
	activeRuntimes.push(runtime);
	await Effect.runPromise(runtime.start);
	return { runtime, onEvent };
};

const getControllerUrl = (runtime: RuntimeHandle) => {
	const controllerUrl = runtime.getControllerUrl();
	if (!controllerUrl) {
		throw new Error("Agent Manager runtime did not expose a controller URL");
	}
	return controllerUrl;
};

const connectRejected = (url: string, token?: string) =>
	new Promise<{ statusCode: number | undefined; body: string }>((resolve, reject) => {
		const ws = new WebSocket(url, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
		let receivedResponse = false;
		let settled = false;

		const timeout = setTimeout(() => {
			if (settled) {
				return;
			}
			settled = true;
			ws.terminate();
			reject(new Error("Timed out waiting for websocket rejection"));
		}, 1_000);

		const settle = (callback: () => void) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			callback();
		};

		ws.once("unexpected-response", (_request, response) => {
			receivedResponse = true;
			let body = "";
			response.setEncoding("utf8");
			response.on("data", (chunk) => {
				body += chunk;
			});
			response.on("end", () => {
				settle(() => resolve({ statusCode: response.statusCode, body }));
			});
		});
		ws.once("open", () => {
			settle(() => {
				ws.close();
				reject(new Error("Expected websocket connection to be rejected"));
			});
		});
		ws.once("error", (error) => {
			if (!receivedResponse) {
				settle(() => reject(error));
			}
		});
	});

const connectAgent = async (runtime: RuntimeHandle, token = "valid-token") => {
	const messages: string[] = [];
	let isClosed = false;
	const ws = new WebSocket(getControllerUrl(runtime), {
		headers: { authorization: `Bearer ${token}` },
	});

	const closed = new Promise<{ code: number; reason: string }>((resolve) => {
		ws.once("close", (code, reason) => {
			isClosed = true;
			resolve({ code, reason: reason.toString() });
		});
	});

	ws.on("message", (data) => {
		messages.push(webSocketRawDataToString(data));
	});
	ws.on("error", () => {});

	try {
		await new Promise<void>((resolve, reject) => {
			ws.once("open", resolve);
			ws.once("error", reject);
			ws.once("unexpected-response", (_request, response) => {
				reject(new Error(`Unexpected websocket response ${response.statusCode}`));
			});
		});
	} catch (error) {
		ws.terminate();
		throw error;
	}

	const agent = {
		ws,
		messages,
		closed,
		get isClosed() {
			return isClosed;
		},
	};
	activeAgents.push(agent);
	return agent;
};

const closeAgent = async (agent: TestAgentConnection) => {
	if (agent.isClosed || agent.ws.readyState === WebSocket.CLOSED) {
		return;
	}

	if (agent.ws.readyState === WebSocket.OPEN || agent.ws.readyState === WebSocket.CONNECTING) {
		agent.ws.close();
	}

	await agent.closed;
};

beforeEach(() => {
	resetAgentsServiceMocks();
	tokenMocks.validateAgentToken.mockReset();
	tokenMocks.validateAgentToken.mockResolvedValue(defaultTokenResult());
});

afterEach(async () => {
	for (const agent of activeAgents.splice(0)) {
		await closeAgent(agent).catch(() => {});
	}
	for (const runtime of activeRuntimes.splice(0).reverse()) {
		await Effect.runPromise(runtime.stop).catch(() => {});
	}

	vi.restoreAllMocks();
	tokenMocks.validateAgentToken.mockReset();
	vi.resetModules();
});

test("websocket upgrade rejects requests without a bearer token", async () => {
	const { runtime } = await startRuntime();

	const response = await connectRejected(getControllerUrl(runtime));

	expect(response.statusCode).toBe(401);
	expect(response.body).toBe("Missing token");
	expect(tokenMocks.validateAgentToken).not.toHaveBeenCalled();
});

test("websocket upgrade rejects invalid bearer tokens", async () => {
	tokenMocks.validateAgentToken.mockResolvedValue(undefined);
	const { runtime } = await startRuntime();

	const response = await connectRejected(getControllerUrl(runtime), "bad-token");

	expect(response.statusCode).toBe(401);
	expect(response.body).toBe("Invalid or revoked token");
	expect(tokenMocks.validateAgentToken).toHaveBeenCalledWith("bad-token");
});

test("websocket upgrade accepts valid agent tokens with connection metadata", async () => {
	const { runtime } = await startRuntime();

	await connectAgent(runtime);

	await waitForExpect(() => {
		expect(agentsServiceMocks.markAgentConnecting).toHaveBeenCalledWith({
			agentId: LOCAL_AGENT_ID,
			organizationId: null,
			agentName: LOCAL_AGENT_NAME,
			agentKind: LOCAL_AGENT_KIND,
		});
	});
	expect(tokenMocks.validateAgentToken).toHaveBeenCalledWith("valid-token");
});

test("websocket lifecycle updates agent connection status", async () => {
	const { runtime } = await startRuntime();
	const agent = await connectAgent(runtime);

	agent.ws.send(createAgentMessage("agent.ready", readyPayload));
	agent.ws.send(createAgentMessage("heartbeat.pong", { sentAt: 123 }));
	await closeAgent(agent);

	await waitForExpect(() => {
		expect(agentsServiceMocks.markAgentConnecting).toHaveBeenCalledWith({
			agentId: LOCAL_AGENT_ID,
			organizationId: null,
			agentName: LOCAL_AGENT_NAME,
			agentKind: LOCAL_AGENT_KIND,
		});
		expect(agentsServiceMocks.markAgentOnline).toHaveBeenCalledWith(LOCAL_AGENT_ID, expect.any(Number), {
			backup: true,
			protocolVersion: 1,
			protocolCompatible: true,
			hostname: "host",
			platform: "linux",
		});
		expect(agentsServiceMocks.markAgentSeen).toHaveBeenCalledWith(LOCAL_AGENT_ID, expect.any(Number));
		expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledWith(LOCAL_AGENT_ID);
	});
});

test("websocket protocol rejection forwards the event and closes the connection", async () => {
	const { runtime, onEvent } = await startRuntime(vi.fn());
	const agent = await connectAgent(runtime);

	agent.ws.send(
		JSON.stringify({
			type: "agent.ready",
			payload: {
				protocolVersion: 2,
				hostname: "host",
				platform: "linux",
			},
		}),
	);
	const closeEvent = await agent.closed;

	await waitForExpect(() => {
		expect(onEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "agent.protocolRejected",
				agentId: LOCAL_AGENT_ID,
				agentName: LOCAL_AGENT_NAME,
				payload: expect.objectContaining({ reason: "agent_too_new" }),
			}),
		);
		expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledWith(LOCAL_AGENT_ID);
	});
	expect(closeEvent.code).toBe(1002);
	expect(closeEvent.reason).toBe("agent_too_new");
});

test("websocket restore events are forwarded with agent metadata", async () => {
	const { runtime, onEvent } = await startRuntime(vi.fn());
	const agent = await connectAgent(runtime);

	agent.ws.send(createAgentMessage("agent.ready", readyPayload));
	await waitForExpect(() => {
		expect(agentsServiceMocks.markAgentOnline).toHaveBeenCalled();
	});
	onEvent.mockClear();

	agent.ws.send(
		createAgentMessage("restore.completed", {
			restoreId: "restore-1",
			organizationId: "org-1",
			repositoryId: "repo-1",
			snapshotId: "snapshot-1",
			result: { message_type: "summary", files_restored: 2, files_skipped: 0 },
		}),
	);

	await waitForExpect(() => {
		expect(onEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "restore.completed",
				agentId: LOCAL_AGENT_ID,
				agentName: LOCAL_AGENT_NAME,
				payload: expect.objectContaining({ restoreId: "restore-1" }),
			}),
		);
	});
});

test("websocket open failure closes the upgraded socket", async () => {
	agentsServiceMocks.markAgentConnecting.mockRejectedValueOnce(new Error("db unavailable"));
	const { runtime } = await startRuntime();
	const agent = await connectAgent(runtime);

	await agent.closed;

	expect(agentsServiceMocks.markAgentConnecting).toHaveBeenCalled();
});

test("shutdown closes all sessions and stops the server when marking one agent offline fails", async () => {
	tokenMocks.validateAgentToken.mockImplementation(async (token: string) => defaultTokenResult(token));
	agentsServiceMocks.markAgentOffline.mockRejectedValueOnce(new Error("db unavailable"));
	const { runtime, onEvent } = await startRuntime(vi.fn());

	await connectAgent(runtime, "agent-1");
	await connectAgent(runtime, "agent-2");
	await waitForExpect(() => {
		expect(agentsServiceMocks.markAgentConnecting).toHaveBeenCalledTimes(2);
	});
	await Effect.runPromise(runtime.stop);

	expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledWith("agent-1");
	expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledWith("agent-2");
	expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "agent.disconnected", agentId: "agent-1" }));
	expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "agent.disconnected", agentId: "agent-2" }));
});

test("closing a replaced connection reports disconnect without marking the active agent offline", async () => {
	const { runtime, onEvent } = await startRuntime(vi.fn());
	const oldAgent = await connectAgent(runtime);
	const newAgent = await connectAgent(runtime);
	const offlineCallsBeforeClose = agentsServiceMocks.markAgentOffline.mock.calls.length;

	newAgent.ws.send(createAgentMessage("agent.ready", readyPayload));
	await waitForExpect(() => {
		expect(agentsServiceMocks.markAgentOnline).toHaveBeenCalled();
	});
	await closeAgent(oldAgent);

	expect(onEvent).toHaveBeenCalledWith(
		expect.objectContaining({ type: "agent.disconnected", agentId: LOCAL_AGENT_ID }),
	);
	expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledTimes(offlineCallsBeforeClose);
	expect(await Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, backupPayload))).toBe(true);
});

test("sendBackup is only delivered after the agent is ready", async () => {
	const { runtime } = await startRuntime();
	const agent = await connectAgent(runtime);
	const payload = backupPayload;

	await expect(Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, payload))).resolves.toBe(false);

	agent.ws.send(createAgentMessage("agent.ready", readyPayload));
	await waitForExpect(() => {
		expect(agentsServiceMocks.markAgentOnline).toHaveBeenCalled();
	});
	await expect(Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, payload))).resolves.toBe(true);

	await waitForExpect(() => {
		expect(agent.messages.some((message) => message.includes('"type":"backup.run"'))).toBe(true);
	});
});
