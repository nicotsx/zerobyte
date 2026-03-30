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

export type AgentConnectionData = {
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
	let isClosed = false;
	const outboundQueue = Effect.runSync(Queue.bounded<ControllerWireMessage>(64));
	const activeBackupJobs = Effect.runSync(Ref.make<Map<string, string>>(new Map()));
	const pendingBackupJobs = Effect.runSync(Ref.make<Map<string, string>>(new Map()));
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

	const setActiveBackupJob = (jobId: string, scheduleId: string) => {
		Effect.runSync(
			Ref.update(activeBackupJobs, (current) => {
				const next = new Map(current);
				next.set(jobId, scheduleId);
				return next;
			}),
		);
	};

	const setPendingBackupJob = (jobId: string, scheduleId: string) => {
		Effect.runSync(
			Ref.update(pendingBackupJobs, (current) => {
				const next = new Map(current);
				next.set(jobId, scheduleId);
				return next;
			}),
		);
	};

	const deleteActiveBackupJob = (jobId: string) => {
		Effect.runSync(
			Ref.update(activeBackupJobs, (current) => {
				const next = new Map(current);
				next.delete(jobId);
				return next;
			}),
		);
	};

	const deletePendingBackupJob = (jobId: string) => {
		Effect.runSync(
			Ref.update(pendingBackupJobs, (current) => {
				const next = new Map(current);
				next.delete(jobId);
				return next;
			}),
		);
	};

	const closeSession = () => {
		if (isClosed) {
			return;
		}

		isClosed = true;
		updateState((current) => ({ ...current, isReady: false }));
		const pendingJobs = Effect.runSync(Ref.get(pendingBackupJobs));
		Effect.runSync(Ref.set(pendingBackupJobs, new Map()));

		for (const [jobId, scheduleId] of pendingJobs) {
			handlers.onBackupCancelled?.({
				jobId,
				scheduleId,
				message:
					"The connection to the backup agent was lost before this backup started. Restart the backup to ensure it completes.",
			});
		}

		const activeJobs = Effect.runSync(Ref.get(activeBackupJobs));
		Effect.runSync(Ref.set(activeBackupJobs, new Map()));
		for (const [jobId, scheduleId] of activeJobs) {
			handlers.onBackupCancelled?.({
				jobId,
				scheduleId,
				message:
					"The connection to the backup agent was lost while this backup was running. Restart the backup to ensure it completes.",
			});
		}
		void Effect.runPromise(Fiber.interrupt(writerFiber)).catch(() => {});
		void Effect.runPromise(Fiber.interrupt(heartbeatFiber)).catch(() => {});
		void Effect.runPromise(Queue.shutdown(outboundQueue)).catch(() => {});
	};

	const handleSendFailure = (reason: string) => {
		logger.error(
			`Closing session for agent ${socket.data.agentId} on ${socket.data.id} after an outbound websocket send failed: ${reason}`,
		);

		try {
			socket.close();
		} catch (error) {
			logger.error(`Failed to close socket for agent ${socket.data.agentId} on ${socket.data.id}: ${toMessage(error)}`);
		}

		closeSession();
	};

	const writerFiber = Effect.runFork(
		Effect.forever(
			Effect.gen(function* () {
				const message = yield* Queue.take(outboundQueue);
				yield* Effect.sync(() => {
					const sendResult = socket.send(message);
					if (sendResult <= 0) {
						handleSendFailure(sendResult === 0 ? "connection issue" : "backpressure");
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
		updateState((current) => ({ ...current, lastSeenAt: Date.now() }));

		switch (message.type) {
			case "agent.ready": {
				updateState((current) => ({ ...current, isReady: true }));
				logger.info(`Agent "${socket.data.agentName}" (${socket.data.agentId}) is ready`);
				break;
			}
			case "backup.started": {
				deletePendingBackupJob(message.payload.jobId);
				setActiveBackupJob(message.payload.jobId, message.payload.scheduleId);
				logger.info(
					`Backup ${message.payload.jobId} started on agent ${socket.data.agentId} for schedule ${message.payload.scheduleId}`,
				);
				handlers.onBackupStarted?.(message.payload);
				break;
			}
			case "backup.progress": {
				handlers.onBackupProgress?.(message.payload);
				break;
			}
			case "backup.completed": {
				deletePendingBackupJob(message.payload.jobId);
				deleteActiveBackupJob(message.payload.jobId);
				handlers.onBackupCompleted?.(message.payload);
				break;
			}
			case "backup.failed": {
				deletePendingBackupJob(message.payload.jobId);
				deleteActiveBackupJob(message.payload.jobId);
				handlers.onBackupFailed?.(message.payload);
				break;
			}
			case "backup.cancelled": {
				deletePendingBackupJob(message.payload.jobId);
				deleteActiveBackupJob(message.payload.jobId);
				handlers.onBackupCancelled?.(message.payload);
				break;
			}
			case "heartbeat.pong": {
				updateState((current) => ({ ...current, lastPongAt: message.payload.sentAt }));
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
			setPendingBackupJob(payload.jobId, payload.scheduleId);
			offerOutbound(createControllerMessage("backup.run", payload));
			return payload.jobId;
		},
		sendBackupCancel: (payload) => {
			offerOutbound(createControllerMessage("backup.cancel", payload));
		},
		isReady: () => Effect.runSync(Ref.get(state)).isReady,
		close: closeSession,
	};
};
