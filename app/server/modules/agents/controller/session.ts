import { Effect, Queue, Ref, type Scope } from "effect";
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
	handleMessage: (data: string) => Effect.Effect<void>;
	sendBackup: (payload: BackupRunPayload) => Effect.Effect<boolean>;
	sendBackupCancel: (payload: BackupCancelPayload) => Effect.Effect<boolean>;
	isReady: () => Effect.Effect<boolean>;
	run: Effect.Effect<void, never, Scope.Scope>;
};

export const createControllerAgentSession = (
	socket: AgentSocket,
	handlers: ControllerAgentSessionHandlers = {},
): Effect.Effect<ControllerAgentSession, never, Scope.Scope> =>
	Effect.gen(function* () {
		const outboundQueue = yield* Queue.bounded<ControllerWireMessage>(64);
		const trackedBackupJobs = yield* Ref.make<Map<string, TrackedBackupJob>>(new Map());
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

		const setTrackedBackupJob = (jobId: string, trackedBackupJob: TrackedBackupJob) => {
			return Ref.update(trackedBackupJobs, (current) => {
				const next = new Map(current);
				next.set(jobId, trackedBackupJob);
				return next;
			});
		};

		const deleteTrackedBackupJob = (jobId: string) => {
			return Ref.update(trackedBackupJobs, (current) => {
				const next = new Map(current);
				next.delete(jobId);
				return next;
			});
		};

		const takeTrackedBackupJobs = Ref.modify(
			trackedBackupJobs,
			(current) => [current, new Map<string, TrackedBackupJob>()] as const,
		);

		const releaseSession = Effect.gen(function* () {
			yield* updateState((current) => ({ ...current, isReady: false }));
			const trackedJobs = yield* takeTrackedBackupJobs;
			for (const [jobId, trackedJob] of trackedJobs) {
				let message = "The connection to the backup agent was lost. Restart the backup to ensure it completes.";

				yield* Effect.sync(() => {
					handlers.onBackupCancelled?.({ jobId, scheduleId: trackedJob.scheduleId, message });
				});
			}

			yield* Queue.shutdown(outboundQueue);
		});

		yield* Effect.addFinalizer(() => releaseSession);

		const run = Effect.gen(function* () {
			yield* Effect.forkScoped(
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
				yield* updateState((current) => ({ ...current, lastSeenAt: Date.now() }));

				switch (message.type) {
					case "agent.ready": {
						yield* updateState((current) => ({ ...current, isReady: true }));
						yield* Effect.sync(() => {
							logger.info(`Agent "${socket.data.agentName}" (${socket.data.agentId}) is ready`);
						});
						break;
					}
					case "backup.started": {
						yield* setTrackedBackupJob(message.payload.jobId, {
							scheduleId: message.payload.scheduleId,
							state: "active",
						});
						yield* Effect.sync(() => {
							logger.info(
								`Backup ${message.payload.jobId} started on agent ${socket.data.agentId} for schedule ${message.payload.scheduleId}`,
							);
							handlers.onBackupStarted?.(message.payload);
						});
						break;
					}
					case "backup.progress": {
						yield* Effect.sync(() => {
							handlers.onBackupProgress?.(message.payload);
						});
						break;
					}
					case "backup.completed": {
						yield* deleteTrackedBackupJob(message.payload.jobId);
						yield* Effect.sync(() => {
							handlers.onBackupCompleted?.(message.payload);
						});
						break;
					}
					case "backup.failed": {
						yield* deleteTrackedBackupJob(message.payload.jobId);
						yield* Effect.sync(() => {
							handlers.onBackupFailed?.(message.payload);
						});
						break;
					}
					case "backup.cancelled": {
						yield* deleteTrackedBackupJob(message.payload.jobId);
						yield* Effect.sync(() => {
							handlers.onBackupCancelled?.(message.payload);
						});
						break;
					}
					case "heartbeat.pong": {
						yield* updateState((current) => ({ ...current, lastPongAt: message.payload.sentAt }));
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
						yield* Effect.sync(() => {
							logger.warn(`Invalid JSON from agent ${socket.data.agentId}`);
						});
						return;
					}

					if (!parsed.success) {
						yield* Effect.sync(() => {
							logger.warn(`Invalid agent message from ${socket.data.agentId}: ${parsed.error.message}`);
						});
						return;
					}

					yield* handleAgentMessage(parsed.data);
				});
			},
			sendBackup: (payload) => {
				return Effect.gen(function* () {
					const queued = yield* offerOutbound(createControllerMessage("backup.run", payload));

					if (queued) {
						yield* setTrackedBackupJob(payload.jobId, { scheduleId: payload.scheduleId, state: "pending" });
					}

					return queued;
				});
			},
			sendBackupCancel: (payload) => offerOutbound(createControllerMessage("backup.cancel", payload)),
			isReady: () => Ref.get(state).pipe(Effect.map((current) => current.isReady)),
			run,
		};
	});
