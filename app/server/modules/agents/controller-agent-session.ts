import { Effect, Fiber, Queue, Ref } from "effect";
import {
	createControllerMessage,
	parseAgentMessage,
	type AgentMessage,
	type BackupCancelledPayload,
	type BackupCompletedPayload,
	type BackupFailedPayload,
	type BackupProgressPayload,
	type BackupRunPayload,
	type BackupCancelPayload,
	type BackupStartedPayload,
	type ControllerWireMessage,
} from "@zerobyte/contracts/agent-protocol";
import { logger } from "@zerobyte/core/node";
import { toMessage } from "@zerobyte/core/utils";

type AgentConnectionData = {
	id: string;
	agentId: string;
	organizationId: string | null;
	agentName: string;
};

type AgentSocket = Bun.ServerWebSocket<AgentConnectionData>;

type SessionState = {
	isReady: boolean;
	lastSeenAt: number | null;
	lastPongAt: number | null;
};

type ControllerAgentSessionHandlers = {
	onBackupStarted?: (payload: BackupStartedPayload) => void;
	onBackupProgress?: (payload: BackupProgressPayload) => void;
	onBackupCompleted?: (payload: BackupCompletedPayload) => void;
	onBackupFailed?: (payload: BackupFailedPayload) => void;
	onBackupCancelled?: (payload: BackupCancelledPayload) => void;
};

export type ControllerAgentSession = {
	readonly connectionId: string;
	handleMessage: (data: string) => void;
	sendBackup: (payload: BackupRunPayload) => string;
	sendBackupCancel: (payload: BackupCancelPayload) => void;
	isReady: () => boolean;
	close: () => void;
};

export const createControllerAgentSession = (
	socket: AgentSocket,
	handlers: ControllerAgentSessionHandlers = {},
): ControllerAgentSession => {
	const outboundQueue = Effect.runSync(Queue.bounded<ControllerWireMessage>(64));
	const state = Effect.runSync(
		Ref.make<SessionState>({
			isReady: false,
			lastSeenAt: null,
			lastPongAt: null,
		}),
	);

	const offerOutbound = (message: ControllerWireMessage) => {
		void Effect.runPromise(Queue.offer(outboundQueue, message)).catch((error) => {
			logger.error(`Failed to queue outbound message for agent ${socket.data.agentId}: ${toMessage(error)}`);
		});
	};

	const updateState = (update: (current: SessionState) => SessionState) => {
		Effect.runSync(Ref.update(state, update));
	};

	const writerFiber = Effect.runFork(
		Effect.forever(
			Effect.gen(function* () {
				const message = yield* Queue.take(outboundQueue);
				yield* Effect.sync(() => {
					try {
						socket.send(message);
					} catch (error) {
						logger.error(
							`Failed to send message to agent ${socket.data.agentId} on ${socket.data.id}: ${toMessage(error)}`,
						);
					}
				});
			}),
		),
	);

	const heartbeatFiber = Effect.runFork(
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

	const handleAgentMessage = (message: AgentMessage) => {
		switch (message.type) {
			case "agent.ready": {
				updateState((current) => ({ ...current, isReady: true, lastSeenAt: Date.now() }));
				logger.info(`Agent "${socket.data.agentName}" (${socket.data.agentId}) is ready`);
				break;
			}
			case "backup.started": {
				updateState((current) => ({ ...current, lastSeenAt: Date.now() }));
				logger.info(
					`Backup ${message.payload.jobId} started on agent ${socket.data.agentId} for schedule ${message.payload.scheduleId}`,
				);
				handlers.onBackupStarted?.(message.payload);
				break;
			}
			case "backup.progress": {
				updateState((current) => ({ ...current, lastSeenAt: Date.now() }));
				handlers.onBackupProgress?.(message.payload);
				break;
			}
			case "backup.completed": {
				updateState((current) => ({ ...current, lastSeenAt: Date.now() }));
				handlers.onBackupCompleted?.(message.payload);
				break;
			}
			case "backup.failed": {
				updateState((current) => ({ ...current, lastSeenAt: Date.now() }));
				handlers.onBackupFailed?.(message.payload);
				break;
			}
			case "backup.cancelled": {
				updateState((current) => ({ ...current, lastSeenAt: Date.now() }));
				handlers.onBackupCancelled?.(message.payload);
				break;
			}
			case "heartbeat.pong": {
				updateState((current) => ({
					...current,
					lastSeenAt: Date.now(),
					lastPongAt: message.payload.sentAt,
				}));
				break;
			}
		}
	};

	return {
		connectionId: socket.data.id,
		handleMessage: (data: string) => {
			const parsed = parseAgentMessage(data);

			if (parsed === null) {
				logger.warn(`Invalid JSON from agent ${socket.data.agentId}`);
				return;
			}

			if (!parsed.success) {
				logger.warn(`Invalid agent message from ${socket.data.agentId}: ${parsed.error.message}`);
				return;
			}

			handleAgentMessage(parsed.data);
		},
		sendBackup: (payload) => {
			offerOutbound(
				createControllerMessage("backup.run", {
					...payload,
				}),
			);
			return payload.jobId;
		},
		sendBackupCancel: (payload) => {
			offerOutbound(
				createControllerMessage("backup.cancel", {
					...payload,
				}),
			);
		},
		isReady: () => Effect.runSync(Ref.get(state)).isReady,
		close: () => {
			updateState((current) => ({ ...current, isReady: false }));
			void Effect.runPromise(Fiber.interrupt(writerFiber)).catch(() => {});
			void Effect.runPromise(Fiber.interrupt(heartbeatFiber)).catch(() => {});
			void Effect.runPromise(Queue.shutdown(outboundQueue)).catch(() => {});
		},
	};
};
