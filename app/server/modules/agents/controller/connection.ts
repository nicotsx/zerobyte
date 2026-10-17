import { Data, Deferred, Effect, Fiber, Queue } from "effect";
import { logger } from "@zerobyte/core/node";
import { toMessage } from "@zerobyte/core/utils";
import {
	createControllerMessage,
	parseAgentMessage,
	parseAgentStartupMessage,
	SUPPORTED_AGENT_PROTOCOL_MAX_VERSION,
	SUPPORTED_AGENT_PROTOCOL_MIN_VERSION,
	type AgentCapabilities,
	type AgentMessage,
	type AgentProtocolRejection,
	type ControllerWireMessage,
	type FilesystemCommand,
	type FilesystemCommandResponsePayload,
} from "@zerobyte/contracts/agent-protocol";
import { agentsService } from "../agents.service";
import type { AgentIdentity } from "../helpers/tokens";
import { serverHasRuntimeFeature } from "../../../lib/permission-service";

const MAX_QUEUED_MESSAGES = 64;
const MAX_QUEUED_BYTES = 1024 * 1024;
const READY_TIMEOUT_MS = 10_000;
const LIVENESS_TIMEOUT_MS = 45_000;

export type AgentConnectionData = AgentIdentity & { id: string };

export type ControllerTransport = {
	send: (message: string) => number | void;
	close: (code?: number, reason?: string) => void;
};

export type ConnectionEvent =
	| Exclude<AgentMessage, { type: "filesystem.commandResult" }>
	| { type: "agent.protocolRejected"; payload: AgentProtocolRejection };

type ConnectionHooks = {
	onEvent: (event: ConnectionEvent) => Effect.Effect<void, Error>;
	onReady: Effect.Effect<void>;
	onClosed: Effect.Effect<void>;
};

type PendingCommand = { deferred: Deferred.Deferred<FilesystemCommandResponsePayload, Error>; name: string };

class ConnectionClosed extends Data.TaggedError("ConnectionClosed")<{ reason: string; code: number }> {}

export type AgentConnection = ReturnType<typeof createAgentConnection>;

export const createAgentConnection = (
	data: AgentConnectionData,
	transport: ControllerTransport,
	hooks: ConnectionHooks,
) => {
	const started = Effect.runSync(Deferred.make<void>());
	const inbox = Effect.runSync(Queue.dropping<string>(MAX_QUEUED_MESSAGES));
	const outbound = Effect.runSync(Queue.bounded<ControllerWireMessage>(MAX_QUEUED_MESSAGES));
	const pendingCommands = new Map<string, PendingCommand>();

	const connectedAt = Date.now();
	let lastSeenAt = connectedAt;
	let queuedBytes = 0;
	let capabilities: AgentCapabilities | null = null;
	let closeReason: string | null = null;

	const closeTransport = (reason: string, code: number) => {
		if (closeReason !== null) return;

		closeReason = reason;

		try {
			transport.close(code, reason);
		} catch (error) {
			logger.warn(`Failed to close agent ${data.agentId}: ${toMessage(error)}`);
		}
	};

	const send = (message: ControllerWireMessage) =>
		Effect.suspend(() => {
			if (closeReason !== null) return Effect.succeed(false);

			return Queue.offer(outbound, message).pipe(Effect.catchCause(() => Effect.succeed(false)));
		});

	const rejectStartup = (rejection: AgentProtocolRejection) =>
		Effect.gen(function* () {
			yield* logger.effect.warn(`Rejecting startup message from agent ${data.agentId}: ${rejection.reason}`);
			yield* hooks.onEvent({ type: "agent.protocolRejected", payload: rejection });

			return yield* new ConnectionClosed({ reason: rejection.reason, code: 1002 });
		});

	const handleMessage = (text: string) =>
		Effect.gen(function* () {
			if (capabilities === null) {
				const startup = parseAgentStartupMessage(text);

				if (!("success" in startup)) return yield* rejectStartup(startup);
			}

			const parsed = parseAgentMessage(text);

			if (parsed === null) return yield* logger.effect.warn(`Invalid JSON from agent ${data.agentId}`);

			if (!parsed.success) {
				if (capabilities !== null) {
					return yield* logger.effect.warn(
						`Invalid agent message from ${data.agentId}: ${parsed.error.message}`,
					);
				}

				return yield* rejectStartup({
					reason: "invalid_agent_ready",
					supportedProtocolMinVersion: SUPPORTED_AGENT_PROTOCOL_MIN_VERSION,
					supportedProtocolMaxVersion: SUPPORTED_AGENT_PROTOCOL_MAX_VERSION,
				});
			}

			const event = parsed.data;

			switch (event.type) {
				case "agent.ready": {
					const readyAt = Date.now();
					const metadata = {
						...event.payload.capabilities,
						protocolVersion: event.payload.protocolVersion,
						protocolCompatible: true,
						hostname: event.payload.hostname,
						platform: event.payload.platform,
					};

					yield* Effect.tryPromise(() => agentsService.markAgentOnline(data, metadata, readyAt));

					lastSeenAt = readyAt;
					capabilities = event.payload.capabilities;

					yield* logger.effect.info(`Agent "${data.agentName}" (${data.agentId}) is ready`);
					return yield* hooks.onReady;
				}
				case "heartbeat.pong": {
					lastSeenAt = Date.now();
					return yield* Effect.tryPromise(() => agentsService.markAgentSeen(data, lastSeenAt));
				}
				case "filesystem.commandResult": {
					const pending = pendingCommands.get(event.payload.commandId);

					if (!pending) {
						return yield* logger.effect.warn(
							`Received response for unknown filesystem command ${event.payload.commandId}`,
						);
					}

					return yield* Deferred.succeed(pending.deferred, event.payload);
				}
				default:
					return yield* hooks.onEvent(event);
			}
		}).pipe(
			Effect.catch((error) => {
				if (error instanceof ConnectionClosed) return Effect.fail(error);

				return logger.effect
					.error(`Inbound message from agent ${data.agentId} failed: ${toMessage(error)}`)
					.pipe(Effect.andThen(new ConnectionClosed({ reason: "inbound_processing_failed", code: 1011 })));
			}),
			Effect.uninterruptible,
		);

	const register = Effect.tryPromise(() => agentsService.markAgentConnecting(data)).pipe(
		Effect.uninterruptible,
		Effect.tapError((error) =>
			logger.effect.error(`Agent connection ${data.id} for ${data.agentId} failed: ${toMessage(error)}`),
		),
		Effect.mapError(() => new ConnectionClosed({ reason: "registration_failed", code: 1011 })),
		Effect.filterOrFail(Boolean, () => new ConnectionClosed({ reason: "credential_changed", code: 1008 })),
	);

	const processInbox = Effect.forever(
		Queue.take(inbox).pipe(
			Effect.tap((text) => Effect.sync(() => (queuedBytes -= Buffer.byteLength(text)))),
			Effect.flatMap(handleMessage),
		),
	);

	const processOutbound = Effect.forever(
		Queue.take(outbound).pipe(
			Effect.flatMap((message) => Effect.try({ try: () => transport.send(message), catch: toMessage })),
			Effect.filterOrFail(
				(sent) => sent !== 0,
				() => "connection issue",
			),
			Effect.tapError((reason) => logger.effect.error(`Failed to send to agent ${data.agentId}: ${reason}`)),
			Effect.mapError(() => new ConnectionClosed({ reason: "transport_send_failed", code: 1000 })),
		),
	);

	const checkLiveness = Effect.forever(
		Effect.gen(function* () {
			yield* Effect.sleep("5 seconds");

			const now = Date.now();

			if (capabilities === null && now - connectedAt >= READY_TIMEOUT_MS) {
				return yield* new ConnectionClosed({ reason: "agent_ready_timeout", code: 1001 });
			}

			if (capabilities !== null && now - lastSeenAt >= LIVENESS_TIMEOUT_MS) {
				return yield* new ConnectionClosed({ reason: "heartbeat_timeout", code: 1001 });
			}
		}),
	);

	const sendHeartbeats = Effect.forever(
		Effect.sleep("15 seconds").pipe(
			Effect.andThen(
				Effect.suspend(() => send(createControllerMessage("heartbeat.ping", { sentAt: Date.now() }))),
			),
		),
	);

	const release = Effect.gen(function* () {
		closeTransport("connection_closed", 1000);

		for (const pending of pendingCommands.values()) {
			yield* Deferred.fail(
				pending.deferred,
				new Error(`Agent session closed before filesystem command ${pending.name} completed`),
			);
		}

		pendingCommands.clear();
		queuedBytes = 0;

		yield* Queue.shutdown(inbox);
		yield* Queue.shutdown(outbound);
		yield* hooks.onClosed;
	});

	const fiber = Effect.runFork(
		Deferred.await(started).pipe(
			Effect.andThen(register),
			Effect.andThen(
				Effect.all([processInbox, processOutbound, checkLiveness, sendHeartbeats], {
					concurrency: "unbounded",
					discard: true,
				}),
			),
			Effect.catch((closed) => Effect.sync(() => closeTransport(closed.reason, closed.code))),
			Effect.ensuring(release),
		),
	);

	const close = (reason: string, code = 1000) =>
		Effect.suspend(() => {
			closeTransport(reason, code);
			return Fiber.interrupt(fiber);
		}).pipe(Effect.asVoid);

	const isReady = () => closeReason === null && capabilities !== null;

	const ownedBy = (organizationId: string) =>
		data.agentKind === "local" ||
		(serverHasRuntimeFeature("remoteAgents") && data.organizationId === organizationId);

	return {
		data,

		isReady,

		start: Deferred.succeed(started, undefined).pipe(Effect.asVoid),

		receive: (text: string) =>
			Effect.suspend(() => {
				if (closeReason !== null) return Effect.void;

				const bytes = Buffer.byteLength(text);

				if (queuedBytes + bytes > MAX_QUEUED_BYTES || !Queue.offerUnsafe(inbox, text)) {
					closeTransport("message_limit", 1009);
					return Effect.sync(() => fiber.interruptUnsafe());
				}

				queuedBytes += bytes;
				return Effect.void;
			}),

		close,

		canBackup: (organizationId: string) =>
			isReady() && ownedBy(organizationId) && capabilities?.trustedRoots?.some((root) => root.canBackup) === true,

		canRestore: (organizationId: string) =>
			isReady() && ownedBy(organizationId) && data.agentKind === "local" && capabilities?.restore === true,

		canAccessRoot: (rootId: string, organizationId: string) =>
			isReady() &&
			ownedBy(organizationId) &&
			capabilities?.trustedRoots?.some((root) => root.id === rootId && root.canBackup) === true,

		send,

		runFilesystemCommand: (command: FilesystemCommand) => {
			const commandId = Bun.randomUUIDv7();

			return Effect.gen(function* () {
				const deferred = yield* Deferred.make<FilesystemCommandResponsePayload, Error>();

				pendingCommands.set(commandId, { deferred, name: command.name });

				if (!(yield* send(createControllerMessage("filesystem.command", { commandId, command })))) {
					return yield* Effect.fail(new Error(`Failed to queue filesystem command ${command.name}`));
				}

				return yield* Deferred.await(deferred).pipe(
					Effect.timeoutOrElse({
						duration: "60 seconds",
						orElse: () => Effect.fail(new Error(`Filesystem command ${command.name} timed out`)),
					}),
				);
			}).pipe(Effect.ensuring(Effect.sync(() => pendingCommands.delete(commandId))));
		},
	};
};
