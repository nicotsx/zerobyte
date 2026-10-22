import { Effect } from "effect";
import { fromPartial } from "@total-typescript/shoehorn";
import { AGENT_PROTOCOL_VERSION } from "@zerobyte/contracts/agent-protocol";
import { beforeEach, expect, test, vi } from "vitest";
import { createAgentMessage } from "@zerobyte/contracts/agent-protocol";

const mocks = vi.hoisted(() => ({
	config: {
		runtime: "server",
		trustProxy: false,
		baseUrl: "http://agents.example.com",
		flags: { enableRemoteAgents: true, allowInsecureAgentHttp: false },
	},
	getController: vi.fn(),
	validateToken: vi.fn(),
	markAgentConnecting: vi.fn(() => Promise.resolve<unknown>({ id: "registered" })),
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
vi.mock("../agents-manager", () => ({ getAgentController: mocks.getController }));
vi.mock("../helpers/tokens", () => ({ validateRemoteAgentToken: mocks.validateToken }));

vi.mock("../agents.service", () => ({
	agentsService: {
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
	mocks.config.flags.enableRemoteAgents = true;
	mocks.config.trustProxy = false;
	mocks.config.flags.allowInsecureAgentHttp = false;
	mocks.config.baseUrl = "http://agents.example.com";

	mocks.getController.mockReset();
	mocks.validateToken.mockReset();
	mocks.markAgentConnecting.mockReset().mockResolvedValue({ id: "registered" });
	mocks.markAgentOnline.mockReset().mockResolvedValue(undefined);
	mocks.markAgentSeen.mockReset().mockResolvedValue(undefined);
	mocks.markAgentOffline.mockReset().mockResolvedValue(undefined);
	mocks.getController.mockReturnValue({ isRunning: () => true });
});

const startController = async () => {
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 4567, stop: vi.fn(async () => undefined) }));

	const { createAgentController } = await import("../controller/server");
	const controller = createAgentController(vi.fn());

	await Effect.runPromise(controller.start);
	mocks.getController.mockReturnValue(controller);

	return controller;
};

test.each(["flag", "desktop"])(
	"rejects remote WebSockets before authentication when disabled by %s",
	async (reason) => {
		const handler = await loadHandler();

		if (reason === "flag") mocks.config.flags.enableRemoteAgents = false;
		else mocks.config.runtime = "desktop";

		await expectRejectedResponse(
			Promise.resolve(
				handler.upgrade?.(
					new Request("http://localhost/api/v1/agents/connect", {
						headers: { authorization: "Bearer saved-machine-credential" },
					}),
				),
			),
			503,
		);
		expect(mocks.validateToken).not.toHaveBeenCalled();
	},
);

test("buffers agent.ready before delayed connection registration completes", async () => {
	let resolveRegistration: (() => void) | undefined;
	const pendingRegistration = new Promise<unknown>((resolve) => {
		resolveRegistration = () => resolve({ id: "registered" });
	});

	const controller = await startController();

	mocks.markAgentConnecting.mockReturnValueOnce(pendingRegistration);

	const handler = await loadHandler();

	const context = {
		id: "connection-1",
		agentId: "remote-1",
		organizationId: "org-1",
		agentName: "Remote",
		agentKind: "remote",
		credentialVersion: 3,
	};

	const peer = { context, send: vi.fn(), close: vi.fn() };

	const open = Promise.resolve(handler.open?.(peer));

	const ready = createAgentMessage("agent.ready", {
		agentId: "remote-1",
		protocolVersion: AGENT_PROTOCOL_VERSION,
		hostname: "host",
		platform: "linux",
		capabilities: { backup: true },
	});

	await handler.message?.(peer, {
		rawData: ready,
		text: () => ready,
	});

	expect(mocks.markAgentOnline).not.toHaveBeenCalled();

	resolveRegistration?.();
	await open;

	await expect(Effect.runPromise(controller.waitForReady("remote-1", 100))).resolves.toBe(true);
	expect(mocks.markAgentOnline).toHaveBeenCalledWith(
		expect.objectContaining({ agentId: "remote-1", credentialVersion: 3 }),
		expect.objectContaining({ protocolVersion: AGENT_PROTOCOL_VERSION, protocolCompatible: true }),
		expect.any(Number),
	);
	expect(peer.close).not.toHaveBeenCalled();

	await Effect.runPromise(controller.stop);
});

test("credential rejection closes the connection without processing buffered ingress", async () => {
	let rejectRegistration: (() => void) | undefined;
	const pendingRegistration = new Promise<unknown>((resolve) => {
		rejectRegistration = () => resolve(undefined);
	});

	const controller = await startController();

	mocks.markAgentConnecting.mockReturnValueOnce(pendingRegistration);

	const handler = await loadHandler();

	const context = {
		id: "connection-rejected",
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

	rejectRegistration?.();
	await open;

	await vi.waitFor(() => expect(mocks.markAgentOffline).toHaveBeenCalledOnce());
	expect(peer.close).toHaveBeenCalledOnce();
	expect(peer.close).toHaveBeenCalledWith(1008, "credential_changed");
	expect(mocks.markAgentConnecting).toHaveBeenCalledOnce();
	expect(mocks.markAgentOnline).not.toHaveBeenCalled();
	expect(controller.isReady("remote-1")).toBe(false);

	await Effect.runPromise(controller.stop);
});

test("public upgrades require a running controller and a remote bearer token", async () => {
	const handler = await loadHandler();

	mocks.getController.mockReturnValueOnce({ isRunning: () => false });

	await expectRejectedResponse(
		Promise.resolve(handler.upgrade?.(new Request("https://localhost/api/v1/agents/connect"))),
		503,
	);

	await expectRejectedResponse(
		Promise.resolve(handler.upgrade?.(new Request("https://localhost/api/v1/agents/connect?token=query"))),
		401,
	);

	mocks.validateToken.mockResolvedValue(null);

	const unknownCredential = new Request("https://localhost/api/v1/agents/connect", {
		headers: { authorization: "Bearer unknown-token" },
	});

	await expectRejectedResponse(Promise.resolve(handler.upgrade?.(unknownCredential)), 401);
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
	const request = new Request("https://localhost/api/v1/agents/connect", {
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

test.each(["https", "wss"])("rejects spoofed forwarded %s when proxy trust is disabled", async (protocol) => {
	const handler = await loadHandler();

	const request = new Request("http://agents.example.com/api/v1/agents/connect", {
		headers: { "x-forwarded-proto": protocol, authorization: "Bearer token" },
	});

	await expectRejectedResponse(Promise.resolve(handler.upgrade?.(request)), 426);
});

test("rejects plaintext even when BASE_URL and the request use loopback", async () => {
	const handler = await loadHandler();

	mocks.config.baseUrl = "http://localhost:3000";

	const request = new Request("http://localhost/api/v1/agents/connect", {
		headers: { authorization: "Bearer token" },
	});

	await expectRejectedResponse(Promise.resolve(handler.upgrade?.(request)), 426);
});

test.each(["https", "wss"])("accepts forwarded %s only from a trusted proxy", async (protocol) => {
	const handler = await loadHandler();

	mocks.config.trustProxy = true;

	mocks.validateToken.mockResolvedValue({
		agentId: "remote-1",
		organizationId: "org-1",
		agentName: "Remote",
		agentKind: "remote",
		credentialVersion: 3,
	});

	const request = new Request("http://localhost/api/v1/agents/connect", {
		headers: { "x-forwarded-proto": protocol, authorization: "Bearer token" },
	});

	await expect(Promise.resolve(handler.upgrade?.(request))).resolves.toEqual({
		context: expect.objectContaining({ agentId: "remote-1", organizationId: "org-1" }),
	});
});

test.each(["http", "ws"])("rejects forwarded plaintext %s even from a trusted proxy", async (protocol) => {
	const handler = await loadHandler();
	mocks.config.trustProxy = true;

	const request = new Request("http://localhost/api/v1/agents/connect", {
		headers: { "x-forwarded-proto": protocol, authorization: "Bearer token" },
	});

	await expectRejectedResponse(Promise.resolve(handler.upgrade?.(request)), 426);
	expect(mocks.validateToken).not.toHaveBeenCalled();
});

test("a failed registration closes the socket and permits reconnect", async () => {
	const controller = await startController();

	mocks.markAgentConnecting.mockRejectedValueOnce(new Error("db unavailable"));

	const handler = await loadHandler();

	const context = {
		id: "connection-failed",
		agentId: "remote-1",
		organizationId: "org-1",
		agentName: "Remote",
		agentKind: "remote",
		credentialVersion: 3,
	};

	const close = vi.fn(() => {
		throw new Error("peer already closed");
	});

	await handler.open?.({ context, send: vi.fn(), close });

	await vi.waitFor(() => expect(mocks.markAgentOffline).toHaveBeenCalledOnce());
	expect(close).toHaveBeenCalledOnce();
	expect(close).toHaveBeenLastCalledWith(1011, "registration_failed");

	const peer = { context: { ...context, id: "connection-valid" }, send: vi.fn(), close: vi.fn() };

	await handler.open?.(peer);

	const ready = createAgentMessage("agent.ready", {
		agentId: "remote-1",
		protocolVersion: AGENT_PROTOCOL_VERSION,
		hostname: "host",
		platform: "linux",
		capabilities: {},
	});

	await handler.message?.(peer, { rawData: ready, text: () => ready });

	await expect(Effect.runPromise(controller.waitForReady("remote-1", 100))).resolves.toBe(true);
	expect(peer.close).not.toHaveBeenCalled();

	await Effect.runPromise(controller.stop);
});

test.each(["https", "http"])("records authoritative security for %s upgrades with HTTP opt-in", async (protocol) => {
	const handler = await loadHandler();
	mocks.config.flags.allowInsecureAgentHttp = true;
	mocks.validateToken.mockResolvedValue({ agentId: "remote-1", agentKind: "remote" });

	const upgrade = await handler.upgrade?.(
		new Request(`${protocol}://localhost/api/v1/agents/connect`, {
			headers: { authorization: "Bearer token", "x-forwarded-proto": "https" },
		}),
	);

	expect(upgrade?.context).toMatchObject({
		agentId: "remote-1",
		connectionSecurity: protocol === "https" ? "secure" : "insecure",
	});
});

test.each(["secure", "insecure"] as const)(
	"an agent cannot override the controller's %s connection metadata",
	async (connectionSecurity) => {
		const controller = await startController();
		const data = {
			id: "connection-security",
			agentId: "remote-1",
			organizationId: "org-1",
			agentName: "Remote",
			agentKind: "remote",
			credentialVersion: 3,
			connectionSecurity,
		};
		const peer = { context: data, send: vi.fn(), close: vi.fn() };
		const handler = await loadHandler();

		try {
			await handler.open?.(peer);
			const ready = createAgentMessage("agent.ready", {
				agentId: "remote-1",
				protocolVersion: AGENT_PROTOCOL_VERSION,
				hostname: "host",
				platform: "linux",
				capabilities: { connectionSecurity: connectionSecurity === "secure" ? "insecure" : "secure" },
			});
			await handler.message?.(peer, { rawData: ready, text: () => ready });

			await expect(Effect.runPromise(controller.waitForReady("remote-1", 100))).resolves.toBe(true);
			expect(mocks.markAgentOnline).toHaveBeenCalledWith(
				expect.objectContaining({ agentId: "remote-1" }),
				expect.objectContaining({ connectionSecurity }),
				expect.any(Number),
			);
		} finally {
			await Effect.runPromise(controller.stop);
		}
	},
);
