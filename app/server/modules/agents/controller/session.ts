import { Deferred, Effect, Queue, Ref, type Scope } from "effect";
import type { AgentKind } from "../../../db/schema";
import {
	createControllerMessage,
	parseAgentMessage,
	parseAgentStartupMessage,
	SUPPORTED_AGENT_PROTOCOL_MAX_VERSION,
	SUPPORTED_AGENT_PROTOCOL_MIN_VERSION,
	type AgentMessage,
	type AgentProtocolRejection,
	type BackupCancelPayload,
	type BackupRunPayload,
	type ControllerWireMessage,
	type RestoreCancelPayload,
	type RestoreRunPayload,
	type VolumeCommand,
	type VolumeCommandResponsePayload,
} from "@zerobyte/contracts/agent-protocol";
import { logger } from "@zerobyte/core/node";
import { toMessage } from "@zerobyte/core/utils";

export type AgentConnectionData = {
	id: string;
	agentId: string;
	organizationId: string | null;
	agentName: string;
	agentKind: AgentKind;
	credentialVersion: number;
};

export type ControllerTransport = {
	send: (message: string) => number | void;
	close: (code?: number, reason?: string) => void;
};

type SessionState = {
	isReady: boolean;
	protocolVersion: number | null;
	lastSeenAt: number | null;
	lastPongAt: number | null;
};

type PendingCommand = { deferred: Deferred.Deferred<VolumeCommandResponsePayload, Error>; description: string };

export type ControllerAgentSessionEvent =
	| AgentMessage
	| { type: "agent.protocolRejected"; payload: AgentProtocolRejection }
	| { type: "session.terminal"; payload: { code?: number; reason: string } };

export type ControllerAgentSession = {
	readonly connectionId: string;
	handleMessage: (data: string) => Effect.Effect<void>;
	sendBackup: (payload: BackupRunPayload) => Effect.Effect<boolean>;
	sendBackupCancel: (payload: BackupCancelPayload) => Effect.Effect<boolean>;
	sendRestore: (payload: RestoreRunPayload) => Effect.Effect<boolean>;
	sendRestoreCancel: (payload: RestoreCancelPayload) => Effect.Effect<boolean>;
	startVolumeCommand: (
		command: VolumeCommand,
	) => Effect.Effect<Effect.Effect<VolumeCommandResponsePayload, Error>, Error>;
	runVolumeCommand: (command: VolumeCommand) => Effect.Effect<VolumeCommandResponsePayload, Error>;
	handleVolumeCommandResult: (payload: VolumeCommandResponsePayload) => Effect.Effect<void>;
	isReady: () => Effect.Effect<boolean>;
	run: Effect.Effect<void, never, Scope.Scope>;
};

type ControllerAgentSessionOptions = {
	startupTimeoutMs?: number;
	livenessTimeoutMs?: number;
	livenessCheckIntervalMs?: number;
	heartbeatIntervalMs?: number;
};

export const createControllerAgentSession = (
	connection: AgentConnectionData,
	transport: ControllerTransport,
	onEvent: (event: ControllerAgentSessionEvent) => Effect.Effect<void>,
	options: ControllerAgentSessionOptions = {},
): Effect.Effect<ControllerAgentSession, never, Scope.Scope> =>
	Effect.gen(function* () {
		let isReleased = false;
		let terminalSignaled = false;

		const connectedAt = Date.now();

		const startupTimeoutMs = options.startupTimeoutMs ?? 10_000;
		const livenessTimeoutMs = options.livenessTimeoutMs ?? 45_000;
		const livenessCheckIntervalMs = options.livenessCheckIntervalMs ?? 5_000;
		const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;

		const outboundQueue = yield* Queue.bounded<ControllerWireMessage>(64);
		const pendingCommands = yield* Ref.make(new Map<string, PendingCommand>());

		const state = yield* Ref.make<SessionState>({
			isReady: false,
			protocolVersion: null,
			lastSeenAt: null,
			lastPongAt: null,
		});

		const offerOutbound = (message: ControllerWireMessage) => {
			if (terminalSignaled) return Effect.succeed(false);
			return Queue.offer(outboundQueue, message).pipe(
				Effect.catchAllCause((cause) =>
					Effect.sync(() => {
						logger.error(
							`Failed to queue outbound message for agent ${connection.agentId}: ${toMessage(cause)}`,
						);
						return false;
					}),
				),
			);
		};

		const updateState = (update: (current: SessionState) => SessionState) => Ref.update(state, update);

		const setPendingCommand = (commandId: string, pending: PendingCommand) =>
			Ref.update(pendingCommands, (current) => new Map(current).set(commandId, pending));

		const removePendingCommand = (commandId: string) =>
			Ref.modify(pendingCommands, (current) => {
				const pending = current.get(commandId) ?? null;
				const next = new Map(current);
				next.delete(commandId);
				return [pending, next];
			});

		const rejectPendingCommands = Effect.gen(function* () {
			const pendingCommandEntries = yield* Ref.get(pendingCommands);
			yield* Ref.set(pendingCommands, new Map());

			for (const pending of pendingCommandEntries.values()) {
				yield* Deferred.fail(
					pending.deferred,
					new Error(`Agent session closed before ${pending.description} completed`),
				);
			}
		});

		const releaseSession = Effect.gen(function* () {
			const disconnectedAt = Date.now();
			yield* updateState((current) => ({ ...current, isReady: false, lastSeenAt: disconnectedAt }));
			yield* rejectPendingCommands;
			yield* Queue.shutdown(outboundQueue);
		});

		const closeSession = () =>
			Effect.suspend(() => {
				if (isReleased) {
					return Effect.sync(() => undefined);
				}

				isReleased = true;
				return releaseSession;
			});

		const signalTerminal = (code: number | undefined, reason: string) =>
			Effect.suspend(() => {
				if (terminalSignaled) return Effect.void;
				terminalSignaled = true;
				return onEvent({ type: "session.terminal", payload: { code, reason } });
			});

		const closeTransport = (code?: number, reason?: string) =>
			Effect.try({
				try: () => transport.close(code, reason),
				catch: (error) => toMessage(error),
			}).pipe(
				Effect.catchAll((error) =>
					logger.effect.error(`Failed to close transport for agent ${connection.agentId}: ${error}`),
				),
			);

		yield* Effect.addFinalizer(() => closeSession());

		const handleSendFailure = (reason: string) => {
			return Effect.gen(function* () {
				logger.error(
					`Closing session for agent ${connection.agentId} on ${connection.id} after an outbound websocket send failed: ${reason}`,
				);

				yield* closeTransport();
				yield* signalTerminal(undefined, "transport_send_failed");
			});
		};

		const run = Effect.gen(function* () {
			yield* Effect.forkScoped(
				Effect.forever(
					Effect.gen(function* () {
						const message = yield* Queue.take(outboundQueue);

						const sendResult = yield* Effect.try({
							try: () => transport.send(message),
							catch: (error) => toMessage(error),
						});

						if (sendResult === 0) {
							yield* handleSendFailure("connection issue");
						}
					}).pipe(Effect.catchAll((reason) => handleSendFailure(reason))),
				),
			);

			yield* Effect.forkScoped(
				Effect.forever(
					Effect.gen(function* () {
						yield* Effect.sleep(livenessCheckIntervalMs);
						const current = yield* Ref.get(state);
						const now = Date.now();
						const startupExpired = !current.isReady && now - connectedAt >= startupTimeoutMs;
						const lastSeenAt = current.lastSeenAt ?? connectedAt;
						const livenessExpired = current.isReady && now - lastSeenAt >= livenessTimeoutMs;
						if (startupExpired || livenessExpired) {
							const reason = startupExpired ? "agent_ready_timeout" : "heartbeat_timeout";
							yield* closeTransport(1001, reason);
							yield* signalTerminal(1001, reason);
						}
					}),
				),
			);

			yield* Effect.forkScoped(
				Effect.forever(
					Effect.gen(function* () {
						yield* Effect.sleep(heartbeatIntervalMs);
						yield* Queue.offer(
							outboundQueue,
							createControllerMessage("heartbeat.ping", {
								sentAt: Date.now(),
							}),
						);
					}),
				),
			);

			return yield* Effect.never;
		});

		const handleVolumeCommandResult = (payload: VolumeCommandResponsePayload) =>
			Effect.gen(function* () {
				const pending = yield* removePendingCommand(payload.commandId);

				if (!pending) {
					yield* logger.effect.warn(`Received response for unknown volume command ${payload.commandId}`);
					return;
				}

				yield* Deferred.succeed(pending.deferred, payload);
			});

		const handleAgentMessage = (message: AgentMessage) =>
			Effect.gen(function* () {
				switch (message.type) {
					case "agent.ready": {
						const readyAt = Date.now();

						yield* updateState((current) => ({
							...current,
							isReady: true,
							protocolVersion: message.payload.protocolVersion,
							lastSeenAt: readyAt,
						}));
						yield* logger.effect.info(`Agent "${connection.agentName}" (${connection.agentId}) is ready`);
						yield* onEvent(message);
						break;
					}
					case "heartbeat.pong": {
						const seenAt = Date.now();

						yield* updateState((current) => ({
							...current,
							lastSeenAt: seenAt,
							lastPongAt: message.payload.sentAt,
						}));
						yield* onEvent(message);
						break;
					}
					case "volume.commandResult": {
						yield* onEvent(message);
						break;
					}
					default: {
						yield* onEvent(message);
						break;
					}
				}
			});

		const rejectStartupMessage = (rejection: AgentProtocolRejection) =>
			Effect.gen(function* () {
				yield* logger.effect.warn(
					`Rejecting startup message from agent ${connection.agentId}: ${rejection.reason}`,
				);
				yield* onEvent({ type: "agent.protocolRejected", payload: rejection });
				yield* closeTransport(1002, rejection.reason);
				yield* signalTerminal(1002, rejection.reason);
			});

		const startVolumeCommand = (command: VolumeCommand) =>
			Effect.gen(function* () {
				const commandId = Bun.randomUUIDv7();
				const description = `volume command ${command.name}`;
				const deferred = yield* Deferred.make<VolumeCommandResponsePayload, Error>();

				yield* setPendingCommand(commandId, { deferred, description });

				const queued = yield* offerOutbound(createControllerMessage("volume.command", { commandId, command }));

				if (!queued) {
					yield* removePendingCommand(commandId);
					return yield* Effect.fail(new Error(`Failed to queue volume command ${command.name}`));
				}

				return Deferred.await(deferred).pipe(
					Effect.timeoutFail({
						duration: "60 seconds",
						onTimeout: () => new Error(`Volume command ${command.name} timed out`),
					}),
					Effect.ensuring(removePendingCommand(commandId)),
				);
			});

		return {
			connectionId: connection.id,
			handleMessage: (data: string) => {
				return Effect.gen(function* () {
					if (terminalSignaled) return;
					const currentState = yield* Ref.get(state);

					if (!currentState.isReady) {
						const startupMessage = parseAgentStartupMessage(data);
						if (!("success" in startupMessage)) {
							yield* rejectStartupMessage(startupMessage);
							return;
						}
					}

					const parsed = parseAgentMessage(data);

					if (parsed === null) {
						yield* logger.effect.warn(`Invalid JSON from agent ${connection.agentId}`);
						return;
					}

					if (!parsed.success) {
						if (!currentState.isReady) {
							yield* rejectStartupMessage({
								reason: "invalid_agent_ready",
								supportedProtocolMinVersion: SUPPORTED_AGENT_PROTOCOL_MIN_VERSION,
								supportedProtocolMaxVersion: SUPPORTED_AGENT_PROTOCOL_MAX_VERSION,
							});
							return;
						}

						yield* logger.effect.warn(
							`Invalid agent message from ${connection.agentId}: ${parsed.error.message}`,
						);
						return;
					}

					yield* handleAgentMessage(parsed.data);
				});
			},
			sendBackup: (payload) => offerOutbound(createControllerMessage("backup.run", payload)),
			sendBackupCancel: (payload) => offerOutbound(createControllerMessage("backup.cancel", payload)),
			sendRestore: (payload) => offerOutbound(createControllerMessage("restore.run", payload)),
			sendRestoreCancel: (payload) => offerOutbound(createControllerMessage("restore.cancel", payload)),
			startVolumeCommand,
			runVolumeCommand: (command) => startVolumeCommand(command).pipe(Effect.flatten),
			isReady: () => Ref.get(state).pipe(Effect.map((current) => current.isReady)),
			handleVolumeCommandResult,
			run,
		};
	});
