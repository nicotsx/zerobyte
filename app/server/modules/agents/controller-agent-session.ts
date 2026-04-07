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

type TrackedBackupJob = {
	scheduleId: string;
	state: "pending" | "active";
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
	sendBackup: (payload: BackupRunPayload) => void;
	sendBackupCancel: (payload: BackupCancelPayload) => void;
	isReady: () => boolean;
	close: () => void;
};

export const createControllerAgentSession = (
	socket: AgentSocket,
	handlers: ControllerAgentSessionHandlers = {},
): ControllerAgentSession => {
	const outboundQueue = Effect.runSync(Queue.bounded<ControllerWireMessage>(64));
	const trackedBackupJobs = Effect.runSync(Ref.make<Map<string, TrackedBackupJob>>(new Map()));
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

	const setTrackedBackupJob = (jobId: string, trackedBackupJob: TrackedBackupJob) => {
		Effect.runSync(
			Ref.update(trackedBackupJobs, (current) => {
				const next = new Map(current);
				next.set(jobId, trackedBackupJob);
				return next;
			}),
		);
	};

	const deleteTrackedBackupJob = (jobId: string) => {
		Effect.runSync(
			Ref.update(trackedBackupJobs, (current) => {
				const next = new Map(current);
				next.delete(jobId);
				return next;
			}),
		);
	};

	const takeTrackedBackupJobs = () => {
		return Effect.runSync(
			Ref.modify(trackedBackupJobs, (current) => [current, new Map<string, TrackedBackupJob>()] as const),
		);
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
		updateState((current) => ({ ...current, lastSeenAt: Date.now() }));

		switch (message.type) {
			case "agent.ready": {
				updateState((current) => ({ ...current, isReady: true }));
				logger.info(`Agent "${socket.data.agentName}" (${socket.data.agentId}) is ready`);
				break;
			}
			case "backup.started": {
				setTrackedBackupJob(message.payload.jobId, {
					scheduleId: message.payload.scheduleId,
					state: "active",
				});
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
				deleteTrackedBackupJob(message.payload.jobId);
				handlers.onBackupCompleted?.(message.payload);
				break;
			}
			case "backup.failed": {
				deleteTrackedBackupJob(message.payload.jobId);
				handlers.onBackupFailed?.(message.payload);
				break;
			}
			case "backup.cancelled": {
				deleteTrackedBackupJob(message.payload.jobId);
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
			setTrackedBackupJob(payload.jobId, {
				scheduleId: payload.scheduleId,
				state: "pending",
			});
			offerOutbound(createControllerMessage("backup.run", payload));
		},
		sendBackupCancel: (payload) => {
			offerOutbound(createControllerMessage("backup.cancel", payload));
		},
		isReady: () => Effect.runSync(Ref.get(state)).isReady,
		close: () => {
			updateState((current) => ({ ...current, isReady: false }));
			const trackedJobs = takeTrackedBackupJobs();
			for (const [jobId, trackedJob] of trackedJobs) {
				let message: string;
				if (trackedJob.state === "pending") {
					message =
						"The connection to the backup agent was lost before this backup started. Restart the backup to ensure it completes.";
				} else {
					message =
						"The connection to the backup agent was lost while this backup was running. Restart the backup to ensure it completes.";
				}

				handlers.onBackupCancelled?.({
					jobId,
					scheduleId: trackedJob.scheduleId,
					message,
				});
			}
			void Effect.runPromise(Fiber.interrupt(writerFiber)).catch(() => {});
			void Effect.runPromise(Fiber.interrupt(heartbeatFiber)).catch(() => {});
			void Effect.runPromise(Queue.shutdown(outboundQueue)).catch(() => {});
		},
	};
};
