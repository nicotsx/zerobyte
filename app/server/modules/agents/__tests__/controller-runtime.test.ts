import { Effect } from "effect";
import { afterEach, expect, test, vi } from "vitest";
import waitForExpect from "wait-for-expect";
import { fromPartial } from "@total-typescript/shoehorn";
import { createAgentMessage } from "@zerobyte/contracts/agent-protocol";
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

const createSocket = (id: string) => ({
	data: {
		id,
		agentId: LOCAL_AGENT_ID,
		organizationId: null,
		agentName: LOCAL_AGENT_NAME,
		agentKind: LOCAL_AGENT_KIND,
	},
	send: vi.fn(() => 1),
	close: vi.fn(),
});

type CapturedFetch = NonNullable<Parameters<typeof Bun.serve>[0]["fetch"]>;

const invokeFetch = (fetch: CapturedFetch | undefined, request: Request, srv: Parameters<CapturedFetch>[1]) => {
	if (!fetch) {
		throw new Error("Bun.serve was not called with a fetch handler");
	}

	return Reflect.apply(fetch, fromPartial<ThisParameterType<CapturedFetch>>({}), [
		request,
		srv,
	]) as ReturnType<CapturedFetch>;
};

const startRuntime = async (onEvent = vi.fn()) => {
	const { createAgentManagerRuntime } = await import("../controller/server");
	const runtime = createAgentManagerRuntime(onEvent);
	await Effect.runPromise(runtime.start);
	return { runtime, onEvent };
};

afterEach(() => {
	vi.restoreAllMocks();
	tokenMocks.validateAgentToken.mockReset();
	vi.resetModules();
});

test("websocket fetch rejects requests without a bearer token", async () => {
	const serve = vi
		.spyOn(Bun, "serve")
		.mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime();
	const fetch = serve.mock.calls[0]?.[0].fetch;
	const upgrade = vi.fn();
	const srv = fromPartial<Parameters<NonNullable<typeof fetch>>[1]>({ upgrade });

	const response = await invokeFetch(fetch, new Request("http://localhost:3001/agent"), srv);
	await Effect.runPromise(runtime.stop);

	expect(response?.status).toBe(401);
	expect(await response?.text()).toBe("Missing token");
	expect(upgrade).not.toHaveBeenCalled();
});

test("websocket fetch rejects invalid bearer tokens", async () => {
	tokenMocks.validateAgentToken.mockResolvedValue(undefined);
	const serve = vi
		.spyOn(Bun, "serve")
		.mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime();
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

test("websocket lifecycle updates agent connection status", async () => {
	const stop = vi.fn(() => Promise.resolve());
	const serve = vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop }));
	const { runtime } = await startRuntime();
	const websocket = serve.mock.calls[0]?.[0].websocket;
	const socket = createSocket("connection-1");

	await websocket?.open?.(fromPartial(socket));
	await websocket?.message?.(fromPartial(socket), createAgentMessage("agent.ready", { agentId: LOCAL_AGENT_ID }));
	await websocket?.message?.(fromPartial(socket), createAgentMessage("heartbeat.pong", { sentAt: 123 }));
	await websocket?.close?.(fromPartial(socket), 1000, "done");
	await Effect.runPromise(runtime.stop);

	expect(agentsServiceMocks.markAgentConnecting).toHaveBeenCalledWith({
		agentId: LOCAL_AGENT_ID,
		organizationId: null,
		agentName: LOCAL_AGENT_NAME,
		agentKind: LOCAL_AGENT_KIND,
	});
	expect(agentsServiceMocks.markAgentOnline).toHaveBeenCalledWith(LOCAL_AGENT_ID, expect.any(Number));
	expect(agentsServiceMocks.markAgentSeen).toHaveBeenCalledWith(LOCAL_AGENT_ID, expect.any(Number));
	expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledWith(LOCAL_AGENT_ID);
	expect(stop).toHaveBeenCalledWith(true);
});

test("closing a replaced connection does not report the active agent as disconnected", async () => {
	const serve = vi
		.spyOn(Bun, "serve")
		.mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime, onEvent } = await startRuntime(vi.fn());
	const websocket = serve.mock.calls[0]?.[0].websocket;
	const oldSocket = createSocket("connection-1");
	const newSocket = createSocket("connection-2");

	await websocket?.open?.(fromPartial(oldSocket));
	await websocket?.open?.(fromPartial(newSocket));
	await websocket?.close?.(fromPartial(oldSocket), 1000, "replaced");

	expect(onEvent).not.toHaveBeenCalledWith(
		expect.objectContaining({ type: "agent.disconnected", agentId: LOCAL_AGENT_ID }),
	);
	await Effect.runPromise(runtime.stop);
});

test("sendBackup is only delivered after the agent is ready", async () => {
	const serve = vi
		.spyOn(Bun, "serve")
		.mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime();
	const websocket = serve.mock.calls[0]?.[0].websocket;
	const socket = createSocket("connection-1");
	const payload = {
		jobId: "job-1",
		scheduleId: "schedule-1",
		organizationId: "org-1",
		sourcePath: "/tmp/source",
		repositoryConfig: { backend: "local" as const, path: "/tmp/repository" },
		options: {},
		runtime: {
			password: "password",
			cacheDir: "/tmp/cache",
			passFile: "/tmp/pass",
			defaultExcludes: [],
			rcloneConfigFile: "/tmp/rclone.conf",
		},
		webhooks: { pre: null, post: null },
		webhookAllowedOrigins: [],
		webhookTimeoutMs: 60_000,
	};

	await websocket?.open?.(fromPartial(socket));
	await expect(Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, payload))).resolves.toBe(false);

	await websocket?.message?.(fromPartial(socket), createAgentMessage("agent.ready", { agentId: LOCAL_AGENT_ID }));
	await expect(Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, payload))).resolves.toBe(true);

	await waitForExpect(() => {
		expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"backup.run"'));
	});
	await Effect.runPromise(runtime.stop);
});
