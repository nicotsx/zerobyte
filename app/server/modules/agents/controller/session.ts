import { Effect, Queue, Ref, type Scope } from "effect";
import type { AgentKind } from "../../../db/schema";
import {
	createControllerMessage,
	parseAgentMessage,
	type AgentMessage,
	type BackupCancelPayload,
	type BackupCancelledPayload,
	type BackupCompletedPayload,
	type BackupFailedPayload,
	type BackupProgressPayload,
	type BackupRunPayload,
	type BackupStartedPayload,
	type ControllerWireMessage,
} from "@zerobyte/contracts/agent-protocol";
import { logger } from "@zerobyte/core/node";
import { toMessage } from "@zerobyte/core/utils";

export type AgentConnectionData = {
	id: string;
	agentId: string;
	organizationId: string | null;
	agentName: string;
	agentKind: AgentKind;
};

type AgentSocket = Bun.ServerWebSocket<AgentConnectionData>;

type SessionState = {
	isReady: boolean;
	lastSeenAt: number | null;
	lastPongAt: number | null;
};

type AgentRuntimeEventPayload = {
	agentId: string;
	agentName: string;
	organizationId: string | null;
	agentKind: AgentKind;
	at: number;
};

type ControllerAgentSessionHandlers = {
	onReady: (payload: AgentRuntimeEventPayload) => Effect.Effect<void>;
	onHeartbeatPong: (payload: AgentRuntimeEventPayload) => Effect.Effect<void>;
	onDisconnect: (payload: AgentRuntimeEventPayload) => Effect.Effect<void>;
	onBackupStarted: (payload: BackupStartedPayload) => Effect.Effect<void>;
	onBackupProgress: (payload: BackupProgressPayload) => Effect.Effect<void>;
	onBackupCompleted: (payload: BackupCompletedPayload) => Effect.Effect<void>;
	onBackupFailed: (payload: BackupFailedPayload) => Effect.Effect<void>;
	onBackupCancelled: (payload: BackupCancelledPayload) => Effect.Effect<void>;
};

export type ControllerAgentSession = {
	readonly connectionId: string;
	handleMessage: (data: string) => Effect.Effect<void>;
	sendBackup: (payload: BackupRunPayload) => Effect.Effect<boolean>;
	sendBackupCancel: (payload: BackupCancelPayload) => Effect.Effect<boolean>;
	isReady: () => Effect.Effect<boolean>;
	run: Effect.Effect<void, never, Scope.Scope>;
};

export const createControllerAgentSession = (
	socket: AgentSocket,
	handlers: ControllerAgentSessionHandlers,
): Effect.Effect<ControllerAgentSession, never, Scope.Scope> =>
	Effect.gen(function* () {
		let isClosed = false;
		const outboundQueue = yield* Queue.bounded<ControllerWireMessage>(64);
		const state = yield* Ref.make<SessionState>({
			isReady: false,
			lastSeenAt: null,
			lastPongAt: null,
		});

		const offerOutbound = (message: ControllerWireMessage) =>
			Queue.offer(outboundQueue, message).pipe(
				Effect.catchAllCause((cause) =>
					Effect.sync(() => {
						logger.error(`Failed to queue outbound message for agent ${socket.data.agentId}: ${toMessage(cause)}`);
						return false;
					}),
				),
			);

		const updateState = (update: (current: SessionState) => SessionState) => Ref.update(state, update);

		const releaseSession = Effect.gen(function* () {
			const disconnectedAt = Date.now();
			yield* updateState((current) => ({ ...current, isReady: false, lastSeenAt: disconnectedAt }));
			yield* handlers.onDisconnect({
				agentId: socket.data.agentId,
				agentName: socket.data.agentName,
				organizationId: socket.data.organizationId,
				agentKind: socket.data.agentKind,
				at: disconnectedAt,
			});

			yield* Queue.shutdown(outboundQueue);
		});

		const closeSession = () =>
			Effect.suspend(() => {
				if (isClosed) {
					return Effect.sync(() => undefined);
				}

				isClosed = true;
				return releaseSession;
			});

		yield* Effect.addFinalizer(() => closeSession());

		const handleSendFailure = (reason: string) => {
			return Effect.gen(function* () {
				logger.error(
					`Closing session for agent ${socket.data.agentId} on ${socket.data.id} after an outbound websocket send failed: ${reason}`,
				);

				yield* Effect.sync(() => socket.close());
				yield* closeSession();
			});
		};

		const run = Effect.gen(function* () {
			yield* Effect.forkScoped(
				Effect.forever(
					Effect.gen(function* () {
						const message = yield* Queue.take(outboundQueue);

						const sendResult = yield* Effect.try({
							try: () => socket.send(message),
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
						yield* Effect.sleep("15 seconds");
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

		const handleAgentMessage = (message: AgentMessage) =>
			Effect.gen(function* () {
				switch (message.type) {
					case "agent.ready": {
						const readyAt = Date.now();
						yield* updateState((current) => ({ ...current, isReady: true, lastSeenAt: readyAt }));

						yield* handlers.onReady({
							agentId: socket.data.agentId,
							agentName: socket.data.agentName,
							organizationId: socket.data.organizationId,
							agentKind: socket.data.agentKind,
							at: readyAt,
						});

						yield* logger.effect.info(`Agent "${socket.data.agentName}" (${socket.data.agentId}) is ready`);
						break;
					}
					case "backup.started": {
						yield* logger.effect.info(
							`Backup ${message.payload.jobId} started on agent ${socket.data.agentId} for schedule ${message.payload.scheduleId}`,
						);
						yield* handlers.onBackupStarted(message.payload);
						break;
					}
					case "backup.progress": {
						yield* handlers.onBackupProgress(message.payload);
						break;
					}
					case "backup.completed": {
						yield* handlers.onBackupCompleted(message.payload);
						break;
					}
					case "backup.failed": {
						yield* handlers.onBackupFailed(message.payload);
						break;
					}
					case "backup.cancelled": {
						yield* handlers.onBackupCancelled(message.payload);
						break;
					}
					case "heartbeat.pong": {
						const seenAt = Date.now();
						yield* updateState((current) => ({ ...current, lastSeenAt: seenAt, lastPongAt: message.payload.sentAt }));

						yield* handlers.onHeartbeatPong({
							agentId: socket.data.agentId,
							agentName: socket.data.agentName,
							organizationId: socket.data.organizationId,
							agentKind: socket.data.agentKind,
							at: seenAt,
						});
						break;
					}
				}
			});

		return {
			connectionId: socket.data.id,
			handleMessage: (data: string) => {
				return Effect.gen(function* () {
					const parsed = parseAgentMessage(data);

					if (parsed === null) {
						yield* logger.effect.warn(`Invalid JSON from agent ${socket.data.agentId}`);
						return;
					}

					if (!parsed.success) {
						yield* logger.effect.warn(`Invalid agent message from ${socket.data.agentId}: ${parsed.error.message}`);
						return;
					}

					yield* handleAgentMessage(parsed.data);
				});
			},
			sendBackup: (payload) => offerOutbound(createControllerMessage("backup.run", payload)),
			sendBackupCancel: (payload) => offerOutbound(createControllerMessage("backup.cancel", payload)),
			isReady: () => Ref.get(state).pipe(Effect.map((current) => current.isReady)),
			run,
		};
	});
