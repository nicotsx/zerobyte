import { Effect, Fiber, Queue, Ref } from "effect";
import {
	createAgentMessage,
	parseControllerMessage,
	type BackupRunPayload,
	type AgentWireMessage,
	type BackupCancelPayload,
	type ControllerWireMessage,
} from "@zerobyte/contracts/agent-protocol";
import { logger } from "@zerobyte/core/node";
import { ResticError, type ResticDeps } from "@zerobyte/core/restic";
import { createRestic } from "@zerobyte/core/restic/server";

const toMessage = (error: unknown) => {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
};

const toErrorDetails = (error: unknown) => {
	if (error instanceof ResticError) {
		return error.details || error.summary;
	}

	return toMessage(error);
};

export type ControllerSession = {
	onOpen: () => void;
	onMessage: (data: unknown) => void;
	close: () => void;
};

export const createControllerSession = (ws: WebSocket): ControllerSession => {
	const outboundQueue = Effect.runSync(Queue.bounded<AgentWireMessage>(64));
	const inboundQueue = Effect.runSync(Queue.bounded<ControllerWireMessage>(64));
	const runningJobsRef = Effect.runSync(
		Ref.make<Map<string, { scheduleId: string; abortController: AbortController }>>(new Map()),
	);

	const getRunningJob = (jobId: string) => Effect.runSync(Ref.get(runningJobsRef)).get(jobId);

	const setRunningJob = (jobId: string, job: { scheduleId: string; abortController: AbortController }) => {
		Effect.runSync(
			Ref.update(runningJobsRef, (current) => {
				const next = new Map(current);
				next.set(jobId, job);
				return next;
			}),
		);
	};

	const deleteRunningJob = (jobId: string) => {
		Effect.runSync(
			Ref.update(runningJobsRef, (current) => {
				const next = new Map(current);
				next.delete(jobId);
				return next;
			}),
		);
	};

	const offerOutbound = (message: AgentWireMessage) => {
		void Effect.runPromise(Queue.offer(outboundQueue, message)).catch((error) => {
			logger.error(`Failed to queue outbound controller message: ${toMessage(error)}`);
		});
	};

	const offerInbound = (message: ControllerWireMessage) => {
		void Effect.runPromise(Queue.offer(inboundQueue, message)).catch((error) => {
			logger.error(`Failed to queue inbound controller message: ${toMessage(error)}`);
		});
	};

	const writerFiber = Effect.runFork(
		Effect.forever(
			Effect.gen(function* () {
				const message = yield* Queue.take(outboundQueue);
				yield* Effect.sync(() => {
					try {
						ws.send(message);
					} catch (error) {
						logger.error(`Failed to send controller message: ${toMessage(error)}`);
					}
				});
			}),
		),
	);

	const processorFiber = Effect.runFork(
		Effect.forever(
			Effect.gen(function* () {
				const data = yield* Queue.take(inboundQueue);
				const parsed = parseControllerMessage(data);

				if (parsed === null) {
					logger.warn("Agent received invalid JSON");
					return;
				}

				if (!parsed.success) {
					logger.warn(`Agent received an invalid message: ${parsed.error.message}`);
					return;
				}

				switch (parsed.data.type) {
					case "backup.run": {
						const runBackup = async (payload: BackupRunPayload) => {
							const existing = getRunningJob(payload.jobId);
							if (existing) {
								offerOutbound(
									createAgentMessage("backup.failed", {
										jobId: payload.jobId,
										scheduleId: payload.scheduleId,
										error: "Backup job is already running",
									}),
								);
								return;
							}

							logger.info(`Starting backup ${payload.jobId} for schedule ${payload.scheduleId}`);
							const abortController = new AbortController();
							setRunningJob(payload.jobId, { scheduleId: payload.scheduleId, abortController });

							offerOutbound(
								createAgentMessage("backup.started", {
									jobId: payload.jobId,
									scheduleId: payload.scheduleId,
								}),
							);

							const deps: ResticDeps = {
								resolveSecret: async (encrypted) => encrypted,
								getOrganizationResticPassword: async () => payload.runtime.password,
								resticCacheDir: payload.runtime.cacheDir,
								resticPassFile: payload.runtime.passFile,
								defaultExcludes: payload.runtime.defaultExcludes,
								hostname: payload.runtime.hostname,
							};

							const restic = createRestic(deps);

							try {
								const result = await restic.backup(payload.repositoryConfig, payload.sourcePath, {
									organizationId: payload.organizationId,
									tags: payload.options.tags,
									oneFileSystem: payload.options.oneFileSystem,
									exclude: payload.options.exclude,
									excludeIfPresent: payload.options.excludeIfPresent,
									includePaths: payload.options.includePaths,
									includePatterns: payload.options.includePatterns,
									customResticParams: payload.options.customResticParams,
									compressionMode: payload.options.compressionMode,
									signal: abortController.signal,
									onProgress: (progress) => {
										offerOutbound(
											createAgentMessage("backup.progress", {
												jobId: payload.jobId,
												scheduleId: payload.scheduleId,
												progress,
											}),
										);
									},
								});

								if (abortController.signal.aborted) {
									offerOutbound(
										createAgentMessage("backup.cancelled", {
											jobId: payload.jobId,
											scheduleId: payload.scheduleId,
											message: "Backup was cancelled",
										}),
									);
									return;
								}

								offerOutbound(
									createAgentMessage("backup.completed", {
										jobId: payload.jobId,
										scheduleId: payload.scheduleId,
										exitCode: result.exitCode,
										result: result.result,
										warningDetails: result.warningDetails ?? undefined,
									}),
								);
							} catch (error) {
								if (abortController.signal.aborted) {
									offerOutbound(
										createAgentMessage("backup.cancelled", {
											jobId: payload.jobId,
											scheduleId: payload.scheduleId,
											message: "Backup was cancelled",
										}),
									);
									return;
								}

								offerOutbound(
									createAgentMessage("backup.failed", {
										jobId: payload.jobId,
										scheduleId: payload.scheduleId,
										error: toMessage(error),
										errorDetails: toErrorDetails(error),
									}),
								);
							} finally {
								deleteRunningJob(payload.jobId);
							}
						};

						void runBackup(parsed.data.payload);
						break;
					}
					case "backup.cancel": {
						const cancelBackup = (payload: BackupCancelPayload) => {
							const running = getRunningJob(payload.jobId);
							if (!running) {
								logger.warn(`Backup ${payload.jobId} is not running`);
								return;
							}

							if (running.scheduleId !== payload.scheduleId) {
								logger.warn(
									`Ignoring cancel for backup ${payload.jobId} due to schedule mismatch ${payload.scheduleId}`,
								);
								return;
							}

							running.abortController.abort();
						};

						cancelBackup(parsed.data.payload);
						break;
					}
					case "heartbeat.ping": {
						yield* Queue.offer(
							outboundQueue,
							createAgentMessage("heartbeat.pong", {
								sentAt: parsed.data.payload.sentAt,
							}),
						);
						break;
					}
				}
			}),
		),
	);

	return {
		onOpen: () => {
			offerOutbound(createAgentMessage("agent.ready", { agentId: "" }));
		},
		onMessage: (data) => {
			if (typeof data !== "string") {
				logger.warn("Agent received a non-text message");
				return;
			}

			offerInbound(data as ControllerWireMessage);
		},
		close: () => {
			const runningJobs = Effect.runSync(Ref.get(runningJobsRef));
			for (const running of runningJobs.values()) {
				running.abortController.abort();
			}
			Effect.runSync(Ref.set(runningJobsRef, new Map()));
			void Effect.runPromise(Fiber.interrupt(writerFiber)).catch(() => {});
			void Effect.runPromise(Fiber.interrupt(processorFiber)).catch(() => {});
			void Effect.runPromise(Queue.shutdown(outboundQueue)).catch(() => {});
			void Effect.runPromise(Queue.shutdown(inboundQueue)).catch(() => {});
		},
	};
};
