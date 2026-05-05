import { Effect, Queue, Ref, type Scope } from "effect";
import type { AgentKind } from "../../../db/schema";
import {
	createControllerMessage,
	parseAgentMessage,
	type AgentMessage,
	type BackupCancelPayload,
	type BackupRunPayload,
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

export type ControllerAgentSessionEvent = AgentMessage | { type: "agent.disconnected" };

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
	onEvent: (event: ControllerAgentSessionEvent) => Effect.Effect<void>,
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
			yield* onEvent({ type: "agent.disconnected" });

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
				if (message.type === "agent.ready") {
					const readyAt = Date.now();
					yield* updateState((current) => ({ ...current, isReady: true, lastSeenAt: readyAt }));
					yield* logger.effect.info(`Agent "${socket.data.agentName}" (${socket.data.agentId}) is ready`);
				}

				if (message.type === "heartbeat.pong") {
					const seenAt = Date.now();
					yield* updateState((current) => ({ ...current, lastSeenAt: seenAt, lastPongAt: message.payload.sentAt }));
				}

				yield* onEvent(message);
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
