import { Effect, Exit, Fiber, Scope } from "effect";
import { expect, test, vi } from "vitest";
import waitForExpect from "wait-for-expect";
import { fromPartial } from "@total-typescript/shoehorn";
import {
	createAgentMessage,
	SUPPORTED_AGENT_PROTOCOL_MAX_VERSION,
	type AgentMessage,
} from "@zerobyte/contracts/agent-protocol";
import type { Volume } from "@zerobyte/contracts/volumes";
import { LOCAL_AGENT_ID, LOCAL_AGENT_KIND, LOCAL_AGENT_NAME } from "../constants";
import { createControllerAgentSession } from "../controller/session";

const createSocket = (overrides: Partial<ReturnType<typeof createSocketBase>> = {}) => {
	return { ...createSocketBase(), ...overrides };
};

const createSocketBase = () => {
	return {
		data: {
			id: "connection-1",
			agentId: LOCAL_AGENT_ID,
			organizationId: null,
			agentName: LOCAL_AGENT_NAME,
			agentKind: LOCAL_AGENT_KIND,
			credentialVersion: 0,
		},
		send: vi.fn(() => 1),
		close: vi.fn(),
	};
};

const createSession = (
	onEvent: Parameters<typeof createControllerAgentSession>[2] = () => Effect.void,
	socket = createSocket(),
	options: Parameters<typeof createControllerAgentSession>[3] = {},
) => {
	const scope = Effect.runSync(Scope.make());

	try {
		const transport = { send: socket.send, close: socket.close };
		const session = Effect.runSync(
			Scope.extend(createControllerAgentSession(fromPartial(socket.data), transport, onEvent, options), scope),
		);

		return {
			session,
			run: () => {
				const fiber = Effect.runFork(Scope.extend(session.run, scope));
				Effect.runSync(Scope.addFinalizer(scope, Fiber.interrupt(fiber)));
				return fiber;
			},
			socket,
			close: () => {
				Effect.runSync(Scope.close(scope, Exit.succeed(undefined)));
			},
			closeAsync: () => {
				return Effect.runPromise(Scope.close(scope, Exit.succeed(undefined)));
			},
		};
	} catch (error) {
		Effect.runSync(Scope.close(scope, Exit.fail(error)));
		throw error;
	}
};

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
	sourceKind: "managed" as const,
	trustedRootId: null,
	relativePath: null,
} satisfies Volume;

test("closing the session scope interrupts the session runner", async () => {
	const { run, closeAsync } = createSession();
	const fiber = run();

	await closeAsync();

	const exit = await Effect.runPromise(Fiber.await(fiber).pipe(Effect.timeout("100 millis")));
	expect(Exit.isInterrupted(exit)).toBe(true);
});

test("closing an externally owned session scope does not emit a terminal signal", () => {
	const onEvent = vi.fn(() => Effect.void);
	const { close } = createSession(onEvent);

	close();

	expect(onEvent).not.toHaveBeenCalled();
});

test("sendBackup only queues the transport message", () => {
	const onEvent = vi.fn(() => Effect.void);
	const { session, close } = createSession(onEvent);

	Effect.runSync(
		session.sendBackup({
			jobId: "job-queued",
			scheduleId: "schedule-queued",
			organizationId: "org-1",
			source: { kind: "managed" as const, volume: backupVolume },
			repositoryConfig: {
				backend: "local",
				path: "/tmp/repository",
			},
			options: {
				oneFileSystem: false,
				excludePatterns: null,
				excludeIfPresent: null,
				includePaths: null,
				includePatterns: null,
				customResticParams: null,
				compressionMode: "auto",
			},
			runtime: {
				password: "password",
			},
			webhooks: { pre: null, post: null },
			webhookAllowedOrigins: [],
			webhookTimeoutMs: 60_000,
		}),
	);

	close();

	expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: "backup.cancelled" }));
});

test("invalid inbound messages are ignored", () => {
	const onEvent = vi.fn(() => Effect.void);
	const { session, close } = createSession(onEvent);

	Effect.runSync(
		session.handleMessage(
			createAgentMessage("agent.ready", {
				agentId: LOCAL_AGENT_ID,
				protocolVersion: 1,
				hostname: "host",
				platform: "linux",
				capabilities: { backup: true },
			}),
		),
	);
	onEvent.mockClear();

	Effect.runSync(session.handleMessage("not json"));
	Effect.runSync(session.handleMessage(JSON.stringify({ type: "backup.progress", payload: {} })));

	expect(onEvent).not.toHaveBeenCalled();
	close();
});

test("agent.ready marks the session ready and forwards the event", () => {
	const onEvent = vi.fn(() => Effect.void);
	const { session, close } = createSession(onEvent);

	expect(Effect.runSync(session.isReady())).toBe(false);
	Effect.runSync(
		session.handleMessage(
			createAgentMessage("agent.ready", {
				agentId: LOCAL_AGENT_ID,
				protocolVersion: 1,
				hostname: "host",
				platform: "linux",
				capabilities: { backup: true },
			}),
		),
	);

	expect(Effect.runSync(session.isReady())).toBe(true);
	expect(onEvent).toHaveBeenCalledWith({
		type: "agent.ready",
		payload: {
			agentId: LOCAL_AGENT_ID,
			protocolVersion: 1,
			hostname: "host",
			platform: "linux",
			capabilities: { backup: true },
		},
	});
	close();
});

test("backup agent messages are forwarded unchanged", () => {
	const onEvent = vi.fn(() => Effect.void);
	const { session, close } = createSession(onEvent);
	const message = {
		type: "backup.progress" as const,
		payload: {
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
		},
	} satisfies Extract<AgentMessage, { type: "backup.progress" }>;

	Effect.runSync(
		session.handleMessage(
			createAgentMessage("agent.ready", {
				agentId: LOCAL_AGENT_ID,
				protocolVersion: 1,
				hostname: "host",
				platform: "linux",
				capabilities: { backup: true },
			}),
		),
	);
	onEvent.mockClear();

	Effect.runSync(session.handleMessage(createAgentMessage(message.type, message.payload)));

	expect(onEvent).toHaveBeenCalledWith(
		expect.objectContaining({
			type: message.type,
			payload: expect.objectContaining({
				jobId: message.payload.jobId,
				scheduleId: message.payload.scheduleId,
				progress: expect.objectContaining(message.payload.progress),
			}),
		}),
	);
	close();
});

test("unsupported agent protocol rejects startup and closes the session", () => {
	const onEvent = vi.fn(() => Effect.void);
	const { session, socket } = createSession(onEvent);

	Effect.runSync(
		session.handleMessage(
			JSON.stringify({
				type: "agent.ready",
				payload: {
					protocolVersion: SUPPORTED_AGENT_PROTOCOL_MAX_VERSION + 1,
					hostname: "host",
					platform: "linux",
				},
			}),
		),
	);

	expect(Effect.runSync(session.isReady())).toBe(false);
	expect(onEvent).toHaveBeenCalledWith({
		type: "agent.protocolRejected",
		payload: expect.objectContaining({
			reason: "agent_too_new",
			protocolVersion: SUPPORTED_AGENT_PROTOCOL_MAX_VERSION + 1,
			hostname: "host",
			platform: "linux",
		}),
	});
	expect(socket.close).toHaveBeenCalledWith(1002, "agent_too_new");
});

test("pre-ready non-ready messages reject startup and close the session", () => {
	const onEvent = vi.fn(() => Effect.void);
	const { session, socket } = createSession(onEvent);

	Effect.runSync(session.handleMessage(createAgentMessage("heartbeat.pong", { sentAt: 123 })));

	expect(Effect.runSync(session.isReady())).toBe(false);
	expect(onEvent).toHaveBeenCalledWith({
		type: "agent.protocolRejected",
		payload: expect.objectContaining({
			reason: "unexpected_startup_message",
			messageType: "heartbeat.pong",
		}),
	});
	expect(socket.close).toHaveBeenCalledWith(1002, "unexpected_startup_message");
});

test("a dropped backup.cancel emits one terminal signal", async () => {
	const send = vi.fn(() => 0);
	const socket = createSocket({ send, close: vi.fn() });
	const onEvent = vi.fn(() => Effect.void);
	const { session, run, closeAsync } = createSession(onEvent, socket);

	try {
		run();
		Effect.runSync(
			session.sendBackupCancel({
				jobId: "job-1",
				scheduleId: "schedule-1",
			}),
		);

		await waitForExpect(() => {
			expect(send).toHaveBeenCalledTimes(1);
			expect(socket.close).toHaveBeenCalledTimes(1);
			expect(onEvent).toHaveBeenCalledTimes(1);
			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "session.terminal",
					payload: { code: undefined, reason: "transport_send_failed" },
				}),
			);
		});
	} finally {
		await closeAsync();
	}
});

test("send and transport close throws still emit one terminal signal and reject later messages", async () => {
	const send = vi.fn(() => {
		throw new Error("send failed");
	});
	const close = vi.fn(() => {
		throw new Error("close failed");
	});
	const socket = createSocket({ send, close });
	const onEvent = vi.fn(() => Effect.void);
	const { session, run, closeAsync } = createSession(onEvent, socket);

	try {
		run();
		Effect.runSync(session.sendBackupCancel({ jobId: "job-1", scheduleId: "schedule-1" }));
		await waitForExpect(() => {
			expect(onEvent).toHaveBeenCalledTimes(1);
			expect(onEvent).toHaveBeenCalledWith({
				type: "session.terminal",
				payload: { code: undefined, reason: "transport_send_failed" },
			});
		});
		Effect.runSync(
			session.handleMessage(
				createAgentMessage("agent.ready", {
					agentId: LOCAL_AGENT_ID,
					protocolVersion: 1,
					hostname: "late",
					platform: "linux",
					capabilities: {},
				}),
			),
		);
		expect(onEvent).toHaveBeenCalledTimes(1);
	} finally {
		await closeAsync();
	}
});

test("heartbeat timeout emits one terminal signal", async () => {
	const onEvent = vi.fn(() => Effect.void);
	const socket = createSocket();
	const options = {
		startupTimeoutMs: 20,
		livenessTimeoutMs: 20,
		livenessCheckIntervalMs: 5,
		heartbeatIntervalMs: 1_000,
	};
	const { session, run, closeAsync } = createSession(onEvent, socket, options);

	try {
		Effect.runSync(
			session.handleMessage(
				createAgentMessage("agent.ready", {
					agentId: LOCAL_AGENT_ID,
					protocolVersion: 1,
					hostname: "host",
					platform: "linux",
					capabilities: {},
				}),
			),
		);
		onEvent.mockClear();
		run();
		await waitForExpect(() => {
			expect(socket.close).toHaveBeenCalledWith(1001, "heartbeat_timeout");
			expect(onEvent).toHaveBeenCalledWith({
				type: "session.terminal",
				payload: { code: 1001, reason: "heartbeat_timeout" },
			});
		});
	} finally {
		await closeAsync();
	}
});
