import { beforeEach, expect, test, vi } from "vitest";
import { createAgentMessage } from "@zerobyte/contracts/agent-protocol";

const mocks = vi.hoisted(() => ({
	config: { runtime: "server", __prod__: false, trustProxy: false, baseUrl: "http://agents.example.com" },
	getRuntime: vi.fn(),
	validateToken: vi.fn(),
	getAgent: vi.fn(),
	markAgentConnecting: vi.fn(() => Promise.resolve()),
	markAgentOnline: vi.fn(() => Promise.resolve()),
	markAgentSeen: vi.fn(() => Promise.resolve()),
	markAgentOffline: vi.fn(() => Promise.resolve()),
}));

type WebSocketHandler = {
	upgrade?: (
		request: Request,
	) => { context?: Record<string, unknown> } | Promise<{ context?: Record<string, unknown> }>;
	open?: (peer: Record<string, unknown>) => void | Promise<void>;
	message?: (peer: Record<string, unknown>, message: Record<string, unknown>) => void | Promise<void>;
	close?: (peer: Record<string, unknown>) => void | Promise<void>;
};

vi.mock("../../../core/config", () => ({ config: mocks.config }));
vi.mock("../agents-manager", () => ({ getAgentManagerRuntime: mocks.getRuntime }));
vi.mock("../helpers/tokens", () => ({ validateRemoteAgentToken: mocks.validateToken }));
vi.mock("../agents.service", () => ({
	agentsService: {
		getAgent: mocks.getAgent,
		markAgentConnecting: mocks.markAgentConnecting,
		markAgentOnline: mocks.markAgentOnline,
		markAgentSeen: mocks.markAgentSeen,
		markAgentOffline: mocks.markAgentOffline,
	},
}));

const loadHandler = async () => {
	const module = await import("../../../../nitro/routes/api/v1/agents/connect");
	const eventHandler = module.default as unknown as (event: unknown) => Response & { crossws: WebSocketHandler };
	return eventHandler({}).crossws;
};

const expectRejectedResponse = async (promise: Promise<unknown>, status: number) => {
	try {
		await promise;
		throw new Error("Expected WebSocket upgrade to be rejected");
	} catch (error) {
		expect(error).toBeInstanceOf(Response);
		expect((error as Response).status).toBe(status);
	}
};

beforeEach(() => {
	mocks.config.runtime = "server";
	mocks.config.__prod__ = false;
	mocks.config.trustProxy = false;
	mocks.config.baseUrl = "http://agents.example.com";
	mocks.getRuntime.mockReset();
	mocks.validateToken.mockReset();
	mocks.getAgent.mockReset();
	mocks.markAgentConnecting.mockReset().mockResolvedValue(undefined);
	mocks.markAgentOnline.mockReset().mockResolvedValue(undefined);
	mocks.markAgentSeen.mockReset().mockResolvedValue(undefined);
	mocks.markAgentOffline.mockReset().mockResolvedValue(undefined);
	mocks.getRuntime.mockReturnValue({});
});

test("buffers agent.ready before delayed credential revalidation completes", async () => {
	let resolveAgent: ((agent: Record<string, unknown>) => void) | undefined;
	const pendingAgent = new Promise<Record<string, unknown>>((resolve) => {
		resolveAgent = resolve;
	});
	const { createAgentManagerRuntime } = await import("../controller/server");
	const runtime = createAgentManagerRuntime(vi.fn());
	const beginOpeningConnection = vi.spyOn(runtime, "beginOpeningConnection");
	mocks.getRuntime.mockReturnValue(runtime);
	mocks.getAgent.mockReturnValueOnce(pendingAgent);
	const handler = await loadHandler();
	const context = {
		connectionId: "connection-1",
		agentId: "remote-1",
		organizationId: "org-1",
		agentName: "Remote",
		agentKind: "remote",
		credentialVersion: 3,
	};
	const peer = { context, send: vi.fn(), close: vi.fn() };
	const open = Promise.resolve(handler.open?.(peer));

	expect(beginOpeningConnection).toHaveBeenCalledOnce();
	const ready = createAgentMessage("agent.ready", {
		agentId: "remote-1",
		protocolVersion: 1,
		hostname: "host",
		platform: "linux",
		capabilities: { backup: true },
	});
	await handler.message?.(peer, {
		rawData: ready,
		text: () => ready,
	});
	expect(mocks.markAgentOnline).not.toHaveBeenCalled();

	resolveAgent?.({
		id: "remote-1",
		kind: "remote",
		organizationId: "org-1",
		credentialVersion: 3,
		revokedAt: null,
		credentialHash: "digest",
	});
	await open;

	await expect(runtime.waitForAgentReady("remote-1", 100)).resolves.toBe(true);
	expect(mocks.markAgentOnline).toHaveBeenCalledWith(
		"remote-1",
		expect.any(Number),
		expect.objectContaining({ protocolVersion: 1, protocolCompatible: true }),
		3,
	);
	expect(peer.close).not.toHaveBeenCalled();
	await runtime.closeConnection("remote-1", "connection-1");
});

test("credential rejection drops buffered ingress without promotion", async () => {
	let resolveAgent: ((agent: Record<string, unknown> | null) => void) | undefined;
	const pendingAgent = new Promise<Record<string, unknown> | null>((resolve) => {
		resolveAgent = resolve;
	});
	const runtime = {
		beginOpeningConnection: vi.fn(),
		promoteOpeningConnection: vi.fn(() => Promise.resolve(true)),
		handleConnectionMessage: vi.fn(() => Promise.resolve()),
		rejectOpeningConnection: vi.fn(() => Promise.resolve(true)),
		closeConnection: vi.fn(() => Promise.resolve(false)),
	};
	mocks.getRuntime.mockReturnValue(runtime);
	mocks.getAgent.mockReturnValueOnce(pendingAgent);
	const handler = await loadHandler();
	const context = {
		connectionId: "connection-rejected",
		agentId: "remote-1",
		organizationId: "org-1",
		agentName: "Remote",
		agentKind: "remote",
		credentialVersion: 3,
	};
	const peer = { context, send: vi.fn(), close: vi.fn() };
	const open = Promise.resolve(handler.open?.(peer));
	await handler.message?.(peer, {
		rawData: '{"type":"agent.ready"}',
		text: () => '{"type":"agent.ready"}',
	});

	resolveAgent?.(null);
	await open;

	expect(runtime.rejectOpeningConnection).toHaveBeenCalledWith(
		"remote-1",
		"connection-rejected",
		"credential_changed",
	);
	expect(runtime.promoteOpeningConnection).not.toHaveBeenCalled();
	expect(mocks.markAgentConnecting).not.toHaveBeenCalled();
});

test("public upgrades require the runtime and a strict remote bearer token", async () => {
	const handler = await loadHandler();
	mocks.getRuntime.mockReturnValueOnce(null);
	await expectRejectedResponse(
		Promise.resolve(handler.upgrade?.(new Request("http://localhost/api/v1/agents/connect"))),
		503,
	);

	await expectRejectedResponse(
		Promise.resolve(handler.upgrade?.(new Request("http://localhost/api/v1/agents/connect?token=query"))),
		401,
	);

	mocks.validateToken.mockResolvedValue({
		agentId: "local",
		organizationId: null,
		agentName: "Local Agent",
		agentKind: "local",
		credentialVersion: 0,
	});
	const localRequest = new Request("http://localhost/api/v1/agents/connect", {
		headers: { authorization: "Bearer local-token" },
	});
	await expectRejectedResponse(Promise.resolve(handler.upgrade?.(localRequest)), 401);
});

test("valid upgrade context contains authoritative metadata but no credential", async () => {
	const handler = await loadHandler();
	mocks.validateToken.mockResolvedValue({
		agentId: "remote-1",
		organizationId: "org-1",
		agentName: "Remote",
		agentKind: "remote",
		credentialVersion: 3,
	});
	const token = "zba1.enrollment-secret";
	const request = new Request("http://localhost/api/v1/agents/connect", {
		headers: { authorization: `Bearer ${token}` },
	});
	const upgrade = await handler.upgrade?.(request);

	expect(upgrade?.context).toMatchObject({
		agentId: "remote-1",
		organizationId: "org-1",
		agentKind: "remote",
		credentialVersion: 3,
	});
	expect(JSON.stringify(upgrade?.context)).not.toContain(token);
	expect(JSON.stringify(upgrade?.context)).not.toContain("secret");
});

test("production rejects spoofed forwarded HTTPS when proxy trust is disabled", async () => {
	const handler = await loadHandler();
	mocks.config.__prod__ = true;
	const request = new Request("http://agents.example.com/api/v1/agents/connect", {
		headers: { "x-forwarded-proto": "https", authorization: "Bearer token" },
	});
	await expectRejectedResponse(Promise.resolve(handler.upgrade?.(request)), 426);
});

test("production rejects plaintext even when BASE_URL and the request use loopback", async () => {
	const handler = await loadHandler();
	mocks.config.__prod__ = true;
	mocks.config.baseUrl = "http://localhost:3000";
	const request = new Request("http://localhost/api/v1/agents/connect", {
		headers: { authorization: "Bearer token" },
	});
	await expectRejectedResponse(Promise.resolve(handler.upgrade?.(request)), 426);
});

test("production accepts forwarded HTTPS only from a trusted proxy", async () => {
	const handler = await loadHandler();
	mocks.config.__prod__ = true;
	mocks.config.trustProxy = true;
	mocks.validateToken.mockResolvedValue({
		agentId: "remote-1",
		organizationId: "org-1",
		agentName: "Remote",
		agentKind: "remote",
		credentialVersion: 3,
	});
	const request = new Request("http://localhost/api/v1/agents/connect", {
		headers: { "x-forwarded-proto": "https", authorization: "Bearer token" },
	});

	await expect(Promise.resolve(handler.upgrade?.(request))).resolves.toEqual({
		context: expect.objectContaining({ agentId: "remote-1", organizationId: "org-1" }),
	});
});

test("open cleans provisional state after DB and promotion failures and permits reconnect", async () => {
	const runtime = {
		beginOpeningConnection: vi.fn(),
		promoteOpeningConnection: vi
			.fn()
			.mockRejectedValueOnce(new Error("promotion failed"))
			.mockResolvedValueOnce(true),
		handleConnectionMessage: vi.fn(() => Promise.resolve()),
		rejectOpeningConnection: vi.fn(() => Promise.resolve(true)),
		closeConnection: vi.fn(() => Promise.resolve(false)),
	};
	mocks.getRuntime.mockReturnValue(runtime);
	const validAgent = {
		id: "remote-1",
		kind: "remote",
		organizationId: "org-1",
		credentialVersion: 3,
		revokedAt: null,
		credentialHash: "digest",
	};
	mocks.getAgent.mockRejectedValueOnce(new Error("db unavailable")).mockResolvedValue(validAgent);
	const handler = await loadHandler();
	const context = {
		connectionId: "connection-failed",
		agentId: "remote-1",
		organizationId: "org-1",
		agentName: "Remote",
		agentKind: "remote",
		credentialVersion: 3,
	};
	const close = vi.fn(() => {
		throw new Error("peer already closed");
	});

	await expect(Promise.resolve(handler.open?.({ context, send: vi.fn(), close }))).resolves.toBeUndefined();
	expect(runtime.rejectOpeningConnection).toHaveBeenCalledWith("remote-1", "connection-failed", "promotion_failed");

	const promotionContext = { ...context, connectionId: "connection-promotion-failed" };
	await expect(
		Promise.resolve(handler.open?.({ context: promotionContext, send: vi.fn(), close })),
	).resolves.toBeUndefined();
	expect(runtime.rejectOpeningConnection).toHaveBeenCalledWith(
		"remote-1",
		"connection-promotion-failed",
		"promotion_failed",
	);

	const validContext = { ...context, connectionId: "connection-valid" };
	await expect(
		Promise.resolve(handler.open?.({ context: validContext, send: vi.fn(), close: vi.fn() })),
	).resolves.toBeUndefined();
	expect(runtime.promoteOpeningConnection).toHaveBeenLastCalledWith("remote-1", "connection-valid");
});
