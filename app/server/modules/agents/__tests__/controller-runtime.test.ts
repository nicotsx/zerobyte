import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import {
	AGENT_PROTOCOL_VERSION,
	MAX_AGENT_TRUSTED_ROOTS,
	SUPPORTED_AGENT_PROTOCOL_MAX_VERSION,
	SUPPORTED_AGENT_PROTOCOL_MIN_VERSION,
	createAgentMessage,
	parseAgentMessage,
	parseControllerMessage,
	type FilesystemCommand,
	type FilesystemCommandResponsePayload,
	type RestoreRunPayload,
} from "@zerobyte/contracts/agent-protocol";
import { createTrustedRootRegistry, getTrustedRootDescriptors } from "../../../../../apps/agent/src/trusted-roots";
import type { AgentConnectionData } from "../controller/connection";
import type { AgentController } from "../controller/server";
import type { AgentIdentity } from "../helpers/tokens";
import { LOCAL_AGENT_ID, LOCAL_AGENT_KIND, LOCAL_AGENT_NAME } from "../constants";

const agentsServiceMocks = vi.hoisted(() => ({
	markAgentConnecting: vi.fn((): Promise<unknown> => Promise.resolve({ id: "registered" })),
	markAgentOnline: vi.fn((): Promise<unknown> => Promise.resolve(undefined)),
	markAgentSeen: vi.fn((): Promise<unknown> => Promise.resolve(undefined)),
	markAgentOffline: vi.fn((): Promise<unknown> => Promise.resolve(undefined)),
}));

const tokenMocks = vi.hoisted(() => ({
	validateLocalAgentToken: vi.fn(),
}));

vi.mock("../agents.service", () => ({
	agentsService: agentsServiceMocks,
}));

vi.mock("../helpers/tokens", () => ({
	validateLocalAgentToken: tokenMocks.validateLocalAgentToken,
}));

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const localIdentity = {
	agentId: LOCAL_AGENT_ID,
	organizationId: null,
	agentName: LOCAL_AGENT_NAME,
	agentKind: LOCAL_AGENT_KIND,
	credentialVersion: 0,
} satisfies AgentIdentity;

const createSocket = (id: string, agentId = LOCAL_AGENT_ID) => ({
	data: {
		...localIdentity,
		id,
		agentId,
		agentName: agentId === LOCAL_AGENT_ID ? LOCAL_AGENT_NAME : `${LOCAL_AGENT_NAME} ${agentId}`,
	} satisfies AgentConnectionData,
	send: vi.fn((_message: string) => 1),
	close: vi.fn(),
});

type TestSocket = ReturnType<typeof createSocket>;

const readyPayload = {
	agentId: LOCAL_AGENT_ID,
	protocolVersion: AGENT_PROTOCOL_VERSION,
	hostname: "host",
	platform: "linux",
	capabilities: {
		restore: true,
		trustedRoots: [{ id: "root", label: "Root", canBackup: true }],
	},
};

const backupPayload = {
	jobId: "job-1",
	scheduleId: "schedule-1",
	organizationId: "org-1",
	source: { rootId: "root", relativePath: "tmp" },
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

const restorePayload = fromPartial<RestoreRunPayload>({
	restoreId: "restore-1",
	organizationId: "org-1",
	repositoryId: "repo-1",
	snapshotId: "snapshot-1",
	target: "/tmp/restore",
	repositoryConfig: { backend: "local", path: "/tmp/repository" },
	runtime: { password: "password" },
	options: { organizationId: "org-1" },
});

const statfsCommand = {
	name: "filesystem.statfs",
	source: { rootId: "root", relativePath: "" },
} satisfies FilesystemCommand;

type CapturedFetch = NonNullable<Parameters<typeof Bun.serve>[0]["fetch"]>;

const invokeFetch = (fetch: CapturedFetch | undefined, request: Request, srv: Parameters<CapturedFetch>[1]) => {
	if (!fetch) throw new Error("Bun.serve was not called with a fetch handler");

	return Reflect.apply(fetch, fromPartial<ThisParameterType<CapturedFetch>>({}), [
		request,
		srv,
	]) as ReturnType<CapturedFetch>;
};

const mockServe = (port = 3001) => {
	const stop = vi.fn(() => Promise.resolve());
	const serve = vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port, stop }));

	return { serve, stop };
};

const startController = async (onEvent = vi.fn()) => {
	const { createAgentController } = await import("../controller/server");
	const controller = createAgentController(onEvent);

	await run(controller.start);
	return { controller, onEvent };
};

const connect = (controller: AgentController, socket: TestSocket, data: AgentConnectionData = socket.data) =>
	controller.socket.open(data, socket);

const deliver = (controller: AgentController, socket: TestSocket, message: string) =>
	controller.socket.message(socket.data, socket, message);

const markReady = async (controller: AgentController, socket: TestSocket, payload = readyPayload) => {
	await deliver(controller, socket, createAgentMessage("agent.ready", { ...payload, agentId: socket.data.agentId }));
	await expect(run(controller.waitForReady(socket.data.agentId, "1 second"))).resolves.toBe(true);
};

const sentMessages = (socket: TestSocket) =>
	socket.send.mock.calls.flatMap(([text]) => {
		const message = parseControllerMessage(text);

		return message?.success ? [message.data] : [];
	});

const sentFilesystemCommands = (socket: TestSocket) =>
	sentMessages(socket).flatMap((message) => (message.type === "filesystem.command" ? [message.payload] : []));

const deferred = <Value = void>() => {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((resolvePromise) => {
		resolve = resolvePromise;
	});

	return { promise, resolve };
};

beforeEach(() => {
	agentsServiceMocks.markAgentConnecting.mockReset().mockResolvedValue({ id: "registered" });
	agentsServiceMocks.markAgentOnline.mockReset().mockResolvedValue(undefined);
	agentsServiceMocks.markAgentSeen.mockReset().mockResolvedValue(undefined);
	agentsServiceMocks.markAgentOffline.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	tokenMocks.validateLocalAgentToken.mockReset();
	vi.resetModules();
});

describe("Local listener", () => {
	const fetchWith = async (headers?: HeadersInit) => {
		const { serve } = mockServe(4567);
		const { controller } = await startController();
		const upgrade = vi.fn(() => true);
		const srv = fromPartial<Parameters<CapturedFetch>[1]>({ upgrade });
		const request = new Request("http://localhost:3001/agent", { headers });
		const response = invokeFetch(serve.mock.calls[0]?.[0].fetch, request, srv);

		return { controller, response, upgrade };
	};

	test("rejects requests without a bearer token", async () => {
		const { controller, response, upgrade } = await fetchWith();

		expect((await response)?.status).toBe(401);
		expect(await (await response)?.text()).toBe("Missing token");
		expect(upgrade).not.toHaveBeenCalled();

		await run(controller.stop);
	});

	test("rejects invalid bearer tokens", async () => {
		tokenMocks.validateLocalAgentToken.mockResolvedValue(null);

		const { controller, response, upgrade } = await fetchWith({ authorization: "Bearer bad-token" });

		expect(controller.getControllerUrl()).toBe("ws://127.0.0.1:4567");
		expect((await response)?.status).toBe(401);
		expect(tokenMocks.validateLocalAgentToken).toHaveBeenCalledWith("bad-token");
		expect(upgrade).not.toHaveBeenCalled();

		await run(controller.stop);
		expect(controller.getControllerUrl()).toBeNull();
	});

	test("upgrades valid tokens with the identity and a fresh connection id", async () => {
		tokenMocks.validateLocalAgentToken.mockResolvedValue(localIdentity);

		const { controller, response, upgrade } = await fetchWith({ authorization: "Bearer valid-token" });

		expect(await response).toBeUndefined();
		expect(upgrade).toHaveBeenCalledWith(expect.any(Request), {
			data: { ...localIdentity, id: expect.any(String) },
		});

		await run(controller.stop);
	});

	test("shutdown fences an upgrade whose token validation began before the stop", async () => {
		const validation = deferred();

		tokenMocks.validateLocalAgentToken.mockImplementation(async () => {
			await validation.promise;
			return localIdentity;
		});

		const { serve, stop } = mockServe();
		const { controller } = await startController();
		const upgrade = vi.fn(() => true);
		const srv = fromPartial<Parameters<CapturedFetch>[1]>({ upgrade });
		const request = new Request("http://localhost:3001/agent", {
			headers: { authorization: "Bearer valid-token" },
		});

		const response = invokeFetch(serve.mock.calls[0]?.[0].fetch, request, srv);

		await vi.waitFor(() => expect(tokenMocks.validateLocalAgentToken).toHaveBeenCalledOnce());
		await run(controller.stop);
		validation.resolve();

		expect((await response)?.status).toBe(503);
		expect(upgrade).not.toHaveBeenCalled();
		expect(stop).toHaveBeenCalledOnce();
	});

	test("socket handlers drive registration, readiness, liveness, and disconnect", async () => {
		const { serve, stop } = mockServe();
		const { controller } = await startController();
		const websocket = serve.mock.calls[0]?.[0].websocket;
		const socket = createSocket("connection-1");

		await websocket?.open?.(fromPartial(socket));
		await websocket?.message?.(fromPartial(socket), createAgentMessage("agent.ready", readyPayload));
		await run(controller.waitForReady(LOCAL_AGENT_ID, "1 second"));
		await websocket?.message?.(fromPartial(socket), createAgentMessage("heartbeat.pong", { sentAt: 123 }));
		await vi.waitFor(() => expect(agentsServiceMocks.markAgentSeen).toHaveBeenCalled());
		await websocket?.close?.(fromPartial(socket), 1000, "done");
		await run(controller.stop);

		expect(agentsServiceMocks.markAgentConnecting).toHaveBeenCalledWith(socket.data);
		expect(agentsServiceMocks.markAgentOnline).toHaveBeenCalledWith(
			socket.data,
			expect.objectContaining({
				trustedRoots: readyPayload.capabilities.trustedRoots,
				protocolVersion: AGENT_PROTOCOL_VERSION,
				protocolCompatible: true,
				hostname: "host",
				platform: "linux",
			}),
			expect.any(Number),
		);
		expect(agentsServiceMocks.markAgentSeen).toHaveBeenCalledWith(socket.data, expect.any(Number));
		expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledWith(socket.data);
		expect(stop).toHaveBeenCalledWith(false);
	});

	test("binary messages close the socket without reaching the connection", async () => {
		const { serve } = mockServe();
		const { controller } = await startController();
		const websocket = serve.mock.calls[0]?.[0].websocket;
		const socket = createSocket("binary-connection");

		await websocket?.open?.(fromPartial(socket));
		await websocket?.message?.(fromPartial(socket), Buffer.from("binary"));

		expect(socket.close).toHaveBeenCalledWith(1003, "text_messages_only");

		await run(controller.stop);
	});
});

describe("Protocol and liveness", () => {
	test.each([
		[SUPPORTED_AGENT_PROTOCOL_MIN_VERSION - 1, "agent_too_old"],
		[SUPPORTED_AGENT_PROTOCOL_MAX_VERSION + 1, "agent_too_new"],
		[AGENT_PROTOCOL_VERSION, "invalid_agent_ready"],
	] as const)("rejects incompatible protocol %s before accepting capabilities", async (protocolVersion, reason) => {
		mockServe();

		const { controller, onEvent } = await startController();
		const socket = createSocket("incompatible-agent");

		await connect(controller, socket);
		await deliver(
			controller,
			socket,
			JSON.stringify({
				type: "agent.ready",
				payload: {
					...readyPayload,
					protocolVersion,
					capabilities: { restore: "future-value", trustedRoots: { future: true } },
				},
			}),
		);

		await vi.waitFor(() => expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledOnce());

		expect(socket.close).toHaveBeenCalledOnce();
		expect(socket.close).toHaveBeenCalledWith(1002, reason);
		expect(onEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "agent.protocolRejected",
				agentId: LOCAL_AGENT_ID,
				agentName: LOCAL_AGENT_NAME,
				payload: expect.objectContaining({ reason }),
			}),
		);
		expect(agentsServiceMocks.markAgentOnline).not.toHaveBeenCalled();
		await expect(run(controller.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(false);

		await run(controller.stop);
	});

	test("rejects operational messages before agent.ready", async () => {
		mockServe();

		const { controller, onEvent } = await startController();
		const socket = createSocket("not-ready-agent");

		await connect(controller, socket);
		await deliver(controller, socket, createAgentMessage("heartbeat.pong", { sentAt: 123 }));

		await vi.waitFor(() => expect(socket.close).toHaveBeenCalledWith(1002, "unexpected_startup_message"));

		expect(onEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "agent.protocolRejected",
				payload: expect.objectContaining({
					reason: "unexpected_startup_message",
					messageType: "heartbeat.pong",
				}),
			}),
		);
		expect(agentsServiceMocks.markAgentSeen).not.toHaveBeenCalled();

		await run(controller.stop);
	});

	test("ignores invalid messages after startup and forwards later backup progress", async () => {
		mockServe();

		const { controller, onEvent } = await startController();
		const socket = createSocket("ready-agent");
		const progress = {
			jobId: "job-1",
			scheduleId: "schedule-1",
			progress: {
				message_type: "status" as const,
				seconds_elapsed: 0,
				seconds_remaining: 0,
				percent_done: 0.5,
				total_files: 0,
				files_done: 0,
				total_bytes: 0,
				bytes_done: 0,
				current_files: [],
			},
		};

		await connect(controller, socket);
		await markReady(controller, socket);

		for (const message of ["invalid JSON", '{"type":"unknown"}']) await deliver(controller, socket, message);

		await deliver(controller, socket, createAgentMessage("backup.progress", progress));

		await vi.waitFor(() => expect(onEvent).toHaveBeenCalledOnce());

		expect(onEvent).toHaveBeenCalledWith({
			type: "backup.progress",
			payload: progress,
			agentId: socket.data.agentId,
			agentName: socket.data.agentName,
		});
		expect(socket.close).not.toHaveBeenCalled();
		expect(controller.isReady(LOCAL_AGENT_ID)).toBe(true);

		await run(controller.stop);
	});

	test("forwards restore events with agent metadata", async () => {
		mockServe();

		const { controller, onEvent } = await startController();
		const socket = createSocket("restore-agent");

		await connect(controller, socket);
		await markReady(controller, socket);
		await deliver(
			controller,
			socket,
			createAgentMessage("restore.completed", {
				restoreId: "restore-1",
				organizationId: "org-1",
				repositoryId: "repo-1",
				snapshotId: "snapshot-1",
				result: { message_type: "summary", files_restored: 2, files_skipped: 0 },
			}),
		);

		await vi.waitFor(() =>
			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "restore.completed",
					agentId: LOCAL_AGENT_ID,
					agentName: LOCAL_AGENT_NAME,
					payload: expect.objectContaining({ restoreId: "restore-1" }),
				}),
			),
		);

		await run(controller.stop);
	});

	test.each([
		[false, 10_000, "agent_ready_timeout"],
		[true, 45_000, "heartbeat_timeout"],
	] as const)("closes once after readiness=%s times out and stops every worker", async (ready, timeout, reason) => {
		vi.useFakeTimers();
		mockServe();

		const { controller, onEvent } = await startController();
		const socket = createSocket("timeout-agent");

		await connect(controller, socket);
		if (ready) await markReady(controller, socket);

		await vi.advanceTimersByTimeAsync(timeout - 1);

		expect(socket.close).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);

		const sendCount = socket.send.mock.calls.length;

		await vi.advanceTimersByTimeAsync(60_000);

		expect(socket.close).toHaveBeenCalledOnce();
		expect(socket.close).toHaveBeenCalledWith(1001, reason);
		expect(socket.send).toHaveBeenCalledTimes(sendCount);
		expect(onEvent).toHaveBeenCalledOnce();
		expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "agent.disconnected" }));
		expect(controller.isReady(LOCAL_AGENT_ID)).toBe(false);

		await run(controller.stop);
	});

	test("heartbeat responses refresh liveness", async () => {
		vi.useFakeTimers();
		mockServe();

		const { controller } = await startController();
		const socket = createSocket("live-agent");

		await connect(controller, socket);
		await markReady(controller, socket);
		await vi.advanceTimersByTimeAsync(30_000);
		await deliver(controller, socket, createAgentMessage("heartbeat.pong", { sentAt: Date.now() }));
		await vi.advanceTimersByTimeAsync(0);

		expect(agentsServiceMocks.markAgentSeen).toHaveBeenCalledOnce();

		await vi.advanceTimersByTimeAsync(44_999);

		expect(socket.close).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);

		expect(socket.close).toHaveBeenCalledWith(1001, "heartbeat_timeout");

		await run(controller.stop);
	});

	const createReadyMessage = (trustedRootCount: number) =>
		JSON.stringify({
			type: "agent.ready",
			payload: {
				agentId: "agent-remote",
				protocolVersion: AGENT_PROTOCOL_VERSION,
				hostname: "archive-node",
				platform: "linux",
				capabilities: {
					trustedRoots: Array.from({ length: trustedRootCount }, (_, index) => ({
						id: `root-${index}`,
						label: `Location ${index}`,
						canBackup: true,
					})),
				},
			},
		});

	test("accepts the canonical maximum trusted-root capability count", () => {
		expect(parseAgentMessage(createReadyMessage(MAX_AGENT_TRUSTED_ROOTS))?.success).toBe(true);
	});

	test("rejects a trusted-root capability count above the canonical maximum", () => {
		expect(parseAgentMessage(createReadyMessage(MAX_AGENT_TRUSTED_ROOTS + 1))?.success).toBe(false);
	});
});

describe("Dispatch", () => {
	const remoteData = {
		id: "connection-1",
		agentId: "agent-1",
		organizationId: "org-1",
		agentName: "Agent 1",
		agentKind: "remote",
		credentialVersion: 1,
	} satisfies AgentConnectionData;

	test("disabling remote agents blocks dispatch on an existing connection", async () => {
		mockServe();
		const { controller } = await startController();
		const { config } = await import("../../../core/config");
		const socket = createSocket(remoteData.id, remoteData.agentId);
		const enabled = config.flags.enableRemoteAgents;

		try {
			await connect(controller, socket, remoteData);
			await markReady(controller, socket);
			config.flags.enableRemoteAgents = false;

			await expect(run(controller.sendBackup(remoteData.agentId, backupPayload))).resolves.toBe(false);
			await expect(
				run(controller.runFilesystemCommand(remoteData.agentId, "org-1", statfsCommand)),
			).resolves.toBeNull();
			expect(sentFilesystemCommands(socket)).toEqual([]);
			expect(sentMessages(socket).some((message) => message.type === "backup.run")).toBe(false);
		} finally {
			config.flags.enableRemoteAgents = enabled;
			await run(controller.stop);
		}
	});

	test("dispatches filesystem commands for advertised remote roots", async () => {
		mockServe();

		const { controller } = await startController();
		const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-runtime-dispatch-"));

		try {
			const trustedRoots = createTrustedRootRegistry({
				roots: [{ id: "data", label: "Data", path: rootPath, allowBackup: true }],
			});
			const socket = createSocket(remoteData.id, remoteData.agentId);
			const source = { rootId: "data", relativePath: "photos" };
			const commands = [
				{ name: "filesystem.browse", source },
				{ name: "filesystem.statfs", source },
				{ name: "filesystem.listFiles", source, offset: 0, limit: 100 },
			] satisfies FilesystemCommand[];

			await connect(controller, socket, remoteData);
			await markReady(controller, socket, {
				...readyPayload,
				capabilities: { trustedRoots: getTrustedRootDescriptors(trustedRoots) },
			} as typeof readyPayload);

			for (const command of commands) {
				const expectedCount = sentFilesystemCommands(socket).length + 1;
				const result = run(controller.runFilesystemCommand(remoteData.agentId, "org-1", command));

				await vi.waitFor(() => expect(sentFilesystemCommands(socket)).toHaveLength(expectedCount));

				const sent = sentFilesystemCommands(socket).at(-1)!;
				const response = {
					commandId: sent.commandId,
					status: "error",
					error: "expected test response",
				} satisfies FilesystemCommandResponsePayload;

				expect(sent.command).toEqual(command);

				await deliver(controller, socket, createAgentMessage("filesystem.commandResult", response));
				await expect(result).resolves.toEqual(response);
			}

			const unadvertised = { name: "filesystem.statfs", source: { rootId: "unadvertised", relativePath: "" } };

			await expect(
				run(controller.runFilesystemCommand(remoteData.agentId, "org-1", unadvertised as FilesystemCommand)),
			).resolves.toBeNull();
			expect(sentFilesystemCommands(socket)).toHaveLength(commands.length);
		} finally {
			await run(controller.stop);
			fs.rmSync(rootPath, { recursive: true, force: true });
		}
	});

	test.each([
		["local", true],
		["remote", true],
		["local", false],
		["remote", false],
	] as const)(
		"dispatches filesystem sources only when their root is advertised: agentKind=%s, advertised=%s",
		async (agentKind, advertised) => {
			mockServe();

			const { controller } = await startController();
			const data: AgentConnectionData =
				agentKind === "local" ? { ...remoteData, agentKind, organizationId: null } : remoteData;
			const socket = createSocket(data.id, data.agentId);
			const command = {
				name: "filesystem.statfs",
				source: { rootId: "local-filesystem", relativePath: "" },
			} satisfies FilesystemCommand;

			await connect(controller, socket, data);
			await markReady(controller, socket, {
				...readyPayload,
				capabilities: {
					trustedRoots: advertised ? [{ id: "local-filesystem", label: "Filesystem", canBackup: true }] : [],
				},
			} as typeof readyPayload);

			const result = run(controller.runFilesystemCommand(data.agentId, "org-1", command));

			if (!advertised) {
				await expect(result).resolves.toBeNull();
				expect(sentFilesystemCommands(socket)).toEqual([]);
				await run(controller.stop);
				return;
			}

			await vi.waitFor(() => expect(sentFilesystemCommands(socket)).toHaveLength(1));

			const response = {
				commandId: sentFilesystemCommands(socket)[0]!.commandId,
				status: "success",
				command: { name: "filesystem.statfs", result: { total: 100, used: 10, free: 90 } },
			} satisfies FilesystemCommandResponsePayload;

			await deliver(controller, socket, createAgentMessage("filesystem.commandResult", response));
			await expect(result).resolves.toEqual(response);

			await run(controller.stop);
		},
	);

	test.each(["disconnect", "shutdown"] as const)("%s rejects an unanswered filesystem command", async (action) => {
		mockServe();

		const { controller } = await startController();
		const socket = createSocket("connection-pending-command");

		await connect(controller, socket);
		await markReady(controller, socket);

		const result = run(controller.runFilesystemCommand(LOCAL_AGENT_ID, "org-1", statfsCommand));
		const rejection = expect(result).rejects.toThrow(
			"Agent session closed before filesystem command filesystem.statfs completed",
		);

		await vi.waitFor(() => expect(sentFilesystemCommands(socket)).toHaveLength(1));

		if (action === "disconnect") {
			await expect(run(controller.disconnect(LOCAL_AGENT_ID))).resolves.toBe(true);
		}

		await run(controller.stop);
		await rejection;

		expect(controller.isReady(LOCAL_AGENT_ID)).toBe(false);
	});

	test("an old connection cannot complete the replacement connection's command", async () => {
		mockServe();

		const { controller } = await startController();
		const oldSocket = createSocket("connection-old");
		const newSocket = createSocket("connection-new");

		for (const socket of [oldSocket, newSocket]) {
			await connect(controller, socket);
			await markReady(controller, socket);
		}

		const result = run(controller.runFilesystemCommand(LOCAL_AGENT_ID, "org-1", statfsCommand));
		const settled = vi.fn();

		void result.then(settled, settled);

		await vi.waitFor(() => expect(sentFilesystemCommands(newSocket)).toHaveLength(1));

		const commandId = sentFilesystemCommands(newSocket)[0]!.commandId;
		const stale = createAgentMessage("filesystem.commandResult", { commandId, status: "error", error: "stale" });

		await deliver(controller, oldSocket, stale);
		expect(settled).not.toHaveBeenCalled();

		const response = { commandId, status: "error" as const, error: "current connection result" };

		await deliver(controller, newSocket, createAgentMessage("filesystem.commandResult", response));
		await expect(result).resolves.toEqual(response);

		await run(controller.stop);
	});
});

describe("Message admission", () => {
	test("sendBackup is only delivered after the agent is ready", async () => {
		mockServe();

		const { controller } = await startController();
		const socket = createSocket("connection-1");

		await connect(controller, socket);
		await expect(run(controller.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(false);

		await markReady(controller, socket);
		await expect(run(controller.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(true);
		await vi.waitFor(() => expect(sentMessages(socket).map((message) => message.type)).toContain("backup.run"));

		await run(controller.stop);
	});

	test("remote restore is rejected before it reaches the transport", async () => {
		mockServe();

		const { controller } = await startController();
		const socket = createSocket("remote-connection", "remote-agent");
		const data = { ...socket.data, organizationId: "org-1", agentKind: "remote" as const, credentialVersion: 1 };

		await connect(controller, socket, data);
		await markReady(controller, socket);

		await expect(run(controller.sendRestore(data.agentId, restorePayload))).resolves.toBe(false);
		expect(sentMessages(socket).map((message) => message.type)).not.toContain("restore.run");

		await run(controller.stop);
	});

	test("admission rejects capability and organization mismatches while cancels only need readiness", async () => {
		mockServe();

		const { controller } = await startController();
		const socket = createSocket("remote-capability-connection", "remote-capability-agent");
		const data = { ...socket.data, organizationId: "org-1", agentKind: "remote" as const, credentialVersion: 1 };

		await connect(controller, socket, data);
		await markReady(controller, socket, {
			...readyPayload,
			capabilities: { restore: false, trustedRoots: [] },
		} as typeof readyPayload);

		await expect(
			run(controller.sendBackup(data.agentId, { ...backupPayload, organizationId: "org-2" })),
		).resolves.toBe(false);
		await expect(run(controller.runFilesystemCommand(data.agentId, "org-2", statfsCommand))).resolves.toBeNull();
		await expect(
			run(
				controller.cancelBackup(data.agentId, {
					jobId: backupPayload.jobId,
					scheduleId: backupPayload.scheduleId,
				}),
			),
		).resolves.toBe(true);
		await vi.waitFor(() =>
			expect(
				sentMessages(socket)
					.filter((message) => message.type !== "heartbeat.ping")
					.map((message) => message.type),
			).toEqual(["backup.cancel"]),
		);

		await run(controller.stop);
	});

	test("commands for unknown agents are rejected and a later connection still works", async () => {
		mockServe();

		const { controller } = await startController();
		const results = await Promise.all(
			Array.from({ length: 100 }, (_, index) =>
				run(controller.sendBackup(`missing-agent-${index}`, backupPayload)),
			),
		);

		expect(results.every((result) => result === false)).toBe(true);

		const socket = createSocket("later-connection", "later-agent");

		await connect(controller, socket);
		await controller.socket.close(socket.data);

		expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledWith(socket.data);

		await run(controller.stop);
	});

	test("buffers startup messages until connection registration completes", async () => {
		const registration = deferred<unknown>();

		agentsServiceMocks.markAgentConnecting.mockReturnValueOnce(registration.promise);
		mockServe();

		const { controller } = await startController();
		const socket = createSocket("connection-1");
		const open = connect(controller, socket);

		await vi.waitFor(() => expect(agentsServiceMocks.markAgentConnecting).toHaveBeenCalledOnce());
		await deliver(controller, socket, createAgentMessage("agent.ready", readyPayload));

		expect(agentsServiceMocks.markAgentOnline).not.toHaveBeenCalled();

		registration.resolve({ id: "registered" });

		await open;
		await expect(run(controller.waitForReady(LOCAL_AGENT_ID, "1 second"))).resolves.toBe(true);
		await expect(run(controller.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(true);

		await run(controller.stop);
	});

	test("disconnecting a connection that is still registering never activates it", async () => {
		const registration = deferred<unknown>();
		const order: string[] = [];

		agentsServiceMocks.markAgentConnecting.mockImplementationOnce(async () => {
			const registered = await registration.promise;

			order.push("connecting");
			return registered;
		});
		agentsServiceMocks.markAgentOffline.mockImplementation(async () => {
			order.push("offline");
		});
		mockServe();

		const { controller } = await startController();
		const socket = createSocket("connection-1");
		const open = connect(controller, socket);

		await vi.waitFor(() => expect(agentsServiceMocks.markAgentConnecting).toHaveBeenCalledOnce());

		const disconnect = run(controller.disconnect(socket.data.agentId));

		registration.resolve({ id: "registered" });

		await expect(disconnect).resolves.toBe(true);
		await open;

		expect(order).toEqual(["connecting", "offline"]);
		expect(socket.close).toHaveBeenCalledWith(1000, "disconnected_by_controller");
		await expect(run(controller.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(false);

		await run(controller.stop);
	});

	test("message count overflow closes without blocking and permits reconnect", async () => {
		const seen = deferred<unknown>();

		agentsServiceMocks.markAgentSeen.mockReturnValueOnce(seen.promise);
		mockServe();

		const { controller } = await startController();
		const socket = createSocket("connection-count-limit");
		const pong = createAgentMessage("heartbeat.pong", { sentAt: 1 });

		await connect(controller, socket);
		await markReady(controller, socket);
		await deliver(controller, socket, pong);
		await vi.waitFor(() => expect(agentsServiceMocks.markAgentSeen).toHaveBeenCalledOnce());

		await Promise.all(Array.from({ length: 64 }, () => deliver(controller, socket, pong)));

		expect(socket.close).not.toHaveBeenCalled();

		await deliver(controller, socket, pong);
		await vi.waitFor(() => expect(socket.close).toHaveBeenCalledWith(1009, "message_limit"));

		seen.resolve(undefined);
		await vi.waitFor(() => expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledWith(socket.data));

		const replacement = createSocket("connection-after-overflow");

		await connect(controller, replacement);
		await markReady(controller, replacement);

		await run(controller.stop);
	});

	test("message byte limit accepts the exact limit and rejects the next byte", async () => {
		const seen = deferred<unknown>();

		agentsServiceMocks.markAgentSeen.mockReturnValueOnce(seen.promise);
		mockServe();

		const { controller } = await startController();
		const socket = createSocket("connection-byte-limit");

		await connect(controller, socket);
		await markReady(controller, socket);
		await deliver(controller, socket, createAgentMessage("heartbeat.pong", { sentAt: 1 }));
		await vi.waitFor(() => expect(agentsServiceMocks.markAgentSeen).toHaveBeenCalledOnce());

		await deliver(controller, socket, "x".repeat(1024 * 1024));

		expect(socket.close).not.toHaveBeenCalled();

		await deliver(controller, socket, "x");
		await vi.waitFor(() => expect(socket.close).toHaveBeenCalledWith(1009, "message_limit"));

		seen.resolve(undefined);
		await run(controller.stop);
	});
});

describe("Connection replacement", () => {
	test("the previous connection is closed and its runs reported lost before the replacement registers", async () => {
		const order: string[] = [];
		const onEvent = vi.fn((event: { type: string }) => {
			order.push(event.type);
		});

		agentsServiceMocks.markAgentConnecting.mockImplementation(async () => {
			order.push("connecting");
			return { id: "registered" };
		});
		agentsServiceMocks.markAgentOffline.mockImplementation(async () => {
			order.push("offline");
		});
		mockServe();

		const { controller } = await startController(onEvent);
		const oldSocket = createSocket("connection-old");
		const newSocket = createSocket("connection-new");

		await connect(controller, oldSocket);
		await markReady(controller, oldSocket);
		await connect(controller, newSocket);

		expect(oldSocket.close).toHaveBeenCalledWith(1000, "connection_replaced");
		await vi.waitFor(() => expect(order).toEqual(["connecting", "agent.disconnected", "connecting"]));
		await expect(run(controller.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(false);

		await markReady(controller, newSocket);
		await expect(run(controller.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(true);
		await vi.waitFor(() => expect(sentMessages(newSocket).map((message) => message.type)).toContain("backup.run"));
		expect(sentMessages(oldSocket).map((message) => message.type)).not.toContain("backup.run");

		await run(controller.stop);
	});

	test("the old socket closing after replacement does not affect the current connection", async () => {
		mockServe();

		const { controller } = await startController();
		const oldSocket = createSocket("connection-old");
		const newSocket = createSocket("connection-new");

		await connect(controller, oldSocket);
		await connect(controller, newSocket);
		await markReady(controller, newSocket);

		const offlineCalls = agentsServiceMocks.markAgentOffline.mock.calls.length;

		await controller.socket.close(oldSocket.data);
		await deliver(controller, oldSocket, createAgentMessage("heartbeat.pong", { sentAt: 1 }));

		expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledTimes(offlineCalls);
		await expect(run(controller.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(true);

		await run(controller.stop);
	});

	test("concurrent opens leave only the latest connection current", async () => {
		mockServe();

		const { controller } = await startController();
		const first = createSocket("first", "concurrent-agent");
		const second = createSocket("second", "concurrent-agent");

		await Promise.all([connect(controller, first), connect(controller, second)]);

		expect(first.close).toHaveBeenCalledWith(1000, "connection_replaced");
		expect(second.close).not.toHaveBeenCalled();

		await run(controller.stop);
	});

	test("a replaced connection never marks the agent offline", async () => {
		mockServe();

		const { controller } = await startController();

		for (const id of ["first", "second", "third"]) await connect(controller, createSocket(id));

		expect(agentsServiceMocks.markAgentOffline).not.toHaveBeenCalled();

		await run(controller.stop);

		expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledOnce();
	});
});

describe("Failure cleanup", () => {
	test("a reentrant close from the transport callback tears down once", async () => {
		mockServe();

		const { controller, onEvent } = await startController();
		const socket = createSocket("reentrant-close");
		const closeCallbacks: Promise<void>[] = [];

		socket.close.mockImplementation(() => {
			closeCallbacks.push(controller.socket.close(socket.data));
		});

		await connect(controller, socket);
		await markReady(controller, socket);
		await run(controller.disconnect(socket.data.agentId));
		await Promise.all(closeCallbacks);

		expect(socket.close).toHaveBeenCalledOnce();
		expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledOnce();
		expect(onEvent).toHaveBeenCalledOnce();
		expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "agent.disconnected" }));
		expect(controller.isReady(socket.data.agentId)).toBe(false);

		await run(controller.stop);
	});

	test("a send failure cleans up even when the transport close throws", async () => {
		mockServe();

		const { controller, onEvent } = await startController();
		const socket = createSocket("connection-send-failure");

		await connect(controller, socket);
		await markReady(controller, socket);

		socket.send.mockImplementation(() => {
			throw new Error("send failed");
		});
		socket.close.mockImplementation(() => {
			throw new Error("close failed");
		});

		await expect(run(controller.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(true);
		await vi.waitFor(() => {
			expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledWith(socket.data);
			expect(onEvent).toHaveBeenCalledOnce();
			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: "agent.disconnected", agentId: LOCAL_AGENT_ID }),
			);
		});

		await deliver(controller, socket, createAgentMessage("heartbeat.pong", { sentAt: 1 }));
		await expect(run(controller.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(false);

		await run(controller.stop);
	});

	test("a zero-byte send result closes the connection", async () => {
		mockServe();

		const { controller } = await startController();
		const socket = createSocket("connection-dropped-send");

		await connect(controller, socket);
		await markReady(controller, socket);

		socket.send.mockReturnValue(0);

		await run(controller.sendBackup(LOCAL_AGENT_ID, backupPayload));
		await vi.waitFor(() => expect(socket.close).toHaveBeenCalledWith(1000, "transport_send_failed"));

		await run(controller.stop);
	});

	test.each([
		["markAgentOnline", "agent.ready"],
		["markAgentSeen", "heartbeat.pong"],
		["onEvent", "restore.completed"],
	] as const)("a %s failure terminates the session and permits reconnect", async (failing, messageType) => {
		const onEvent = vi.fn((event: { type: string }) =>
			failing === "onEvent" && event.type === "restore.completed"
				? Promise.reject(new Error("event handler failed"))
				: Promise.resolve(),
		);

		if (failing === "markAgentOnline")
			agentsServiceMocks.markAgentOnline.mockRejectedValueOnce(new Error("db down"));
		if (failing === "markAgentSeen") agentsServiceMocks.markAgentSeen.mockRejectedValueOnce(new Error("db down"));
		mockServe();

		const { controller } = await startController(onEvent);
		const socket = createSocket(`connection-${failing}-failure`);
		const messages = {
			"agent.ready": createAgentMessage("agent.ready", readyPayload),
			"heartbeat.pong": createAgentMessage("heartbeat.pong", { sentAt: 1 }),
			"restore.completed": createAgentMessage("restore.completed", {
				restoreId: "restore-failed",
				organizationId: "org-1",
				repositoryId: "repo-1",
				snapshotId: "snapshot-1",
				result: { message_type: "summary", files_restored: 1, files_skipped: 0 },
			}),
		};

		await connect(controller, socket);
		if (messageType !== "agent.ready") await markReady(controller, socket);
		await deliver(controller, socket, messages[messageType]);

		await vi.waitFor(() => {
			expect(socket.close).toHaveBeenCalledWith(1011, "inbound_processing_failed");
			expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledOnce();
			expect(onEvent).toHaveBeenLastCalledWith(
				expect.objectContaining({ type: "agent.disconnected", agentId: LOCAL_AGENT_ID }),
			);
		});

		expect(controller.isReady(LOCAL_AGENT_ID)).toBe(false);
		await expect(run(controller.disconnect(LOCAL_AGENT_ID))).resolves.toBe(false);
		await expect(run(controller.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(false);
		expect(socket.close).toHaveBeenCalledOnce();

		const replacement = createSocket(`connection-after-${failing}-failure`);

		await connect(controller, replacement);
		await markReady(controller, replacement);

		await run(controller.stop);
	});
});

describe("Controller lifecycle", () => {
	test("stop contains cleanup failures, closes every connection, and stops the listener once", async () => {
		agentsServiceMocks.markAgentOffline.mockRejectedValueOnce(new Error("db unavailable"));

		const { stop } = mockServe();
		const onEvent = vi.fn((event: { type: string; agentId?: string }) =>
			event.type === "agent.disconnected" && event.agentId === "agent-1"
				? Promise.reject(new Error("disconnect callback failed"))
				: Promise.resolve(),
		);
		const { controller } = await startController(onEvent);
		const firstSocket = createSocket("connection-1", "agent-1");
		const secondSocket = createSocket("connection-2", "agent-2");

		await connect(controller, firstSocket);
		await connect(controller, secondSocket);

		firstSocket.close.mockImplementation(() => {
			throw new Error("close failed");
		});

		await expect(run(controller.stop)).resolves.toBeUndefined();

		for (const socket of [firstSocket, secondSocket]) {
			expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledWith(socket.data);
			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: "agent.disconnected", agentId: socket.data.agentId }),
			);
			expect(socket.close).toHaveBeenCalledWith(1000, "controller_shutdown");
		}

		expect(stop).toHaveBeenCalledOnce();
		expect(stop).toHaveBeenCalledWith(false);
	});

	test("a stopped controller refuses connections and releases readiness waiters", async () => {
		mockServe();

		const { controller } = await startController();
		const waiting = run(controller.waitForReady(LOCAL_AGENT_ID, "10 seconds"));

		await run(controller.stop);
		await expect(waiting).resolves.toBe(false);

		const socket = createSocket("after-stop");

		await connect(controller, socket);

		expect(socket.close).toHaveBeenCalledWith(1008, "controller_stopping");
	});

	test("restarting creates a fresh listener and accepts connections again", async () => {
		const serve = vi
			.spyOn(Bun, "serve")
			.mockReturnValueOnce(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }))
			.mockReturnValueOnce(fromPartial({ port: 3002, stop: vi.fn(() => Promise.resolve()) }));

		const { controller } = await startController();

		await run(controller.start);
		expect(serve).toHaveBeenCalledOnce();

		await run(controller.stop);
		await run(controller.start);

		expect(serve).toHaveBeenCalledTimes(2);
		expect(controller.getControllerUrl()).toBe("ws://127.0.0.1:3002");
		const socket = createSocket("after-restart");

		await connect(controller, socket);
		await markReady(controller, socket);

		await run(controller.stop);
	});

	test("a failed listener start leaves the controller stopped", async () => {
		vi.spyOn(Bun, "serve").mockImplementationOnce(() => {
			throw new Error("listener failed to start");
		});

		const { createAgentController } = await import("../controller/server");
		const controller = createAgentController(vi.fn());

		await expect(run(controller.start)).rejects.toThrow("listener failed to start");
		expect(controller.isRunning()).toBe(false);
		expect(controller.getControllerUrl()).toBeNull();
	});
});
