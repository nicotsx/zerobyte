import { logger } from "@zerobyte/core/node";
import type {
	BackupRunPayload,
	RestoreRunPayload,
	FilesystemCommand,
	FilesystemCommandResult,
} from "@zerobyte/contracts/agent-protocol";
import { Cause, Deferred, Effect, Exit, Fiber, Option } from "effect";
import { config } from "../../core/config";
import { runEffectPromise, toMessage } from "../../utils/errors";
import { createAgentManagerRuntime, type AgentManagerEvent, type AgentManagerRuntime } from "./controller/server";
import { LOCAL_AGENT_ID } from "./constants";
import { spawnLocalAgentProcess, stopLocalAgentProcess, waitForLocalAgentExit } from "./local/process";
import {
	createAgentRuntimeState,
	type AgentRuntimeState,
	type BackupExecutionProgress,
	type BackupExecutionResult,
	type RestoreExecutionProgress,
	type RestoreExecutionResult,
} from "./helpers/runtime-state";
import { getDevAgentRuntimeState } from "./helpers/runtime-state.dev";
export type {
	BackupExecutionProgress,
	BackupExecutionResult,
	RestoreExecutionProgress,
	RestoreExecutionResult,
} from "./helpers/runtime-state";
export type { ProcessWithAgentRuntime } from "./helpers/runtime-state.dev";

type ProcessWithProductionAgentRuntime = NodeJS.Process & {
	__zerobyteProductionAgentRuntime?: AgentRuntimeState;
};

type AgentRunBackupRequest = {
	scheduleId: number;
	payload: BackupRunPayload;
	signal: AbortSignal;
	onProgress: (progress: BackupExecutionProgress) => void;
};

type AgentStartRestoreRequest = {
	payload: RestoreRunPayload;
	signal: AbortSignal;
	onProgress: (progress: RestoreExecutionProgress) => void;
};

type AgentRestoreStartResult =
	| { status: "started"; result: Promise<RestoreExecutionResult> }
	| { status: "unavailable"; error: Error };

const getProductionAgentRuntimeState = () => {
	// Nitro production builds can bundle startup plugins and API handlers into separate chunks.
	// Keep the live controller on process so both chunks see the same agent sessions.
	const runtimeProcess = process as ProcessWithProductionAgentRuntime;
	if (!runtimeProcess.__zerobyteProductionAgentRuntime) {
		runtimeProcess.__zerobyteProductionAgentRuntime = createAgentRuntimeState();
	}

	return runtimeProcess.__zerobyteProductionAgentRuntime;
};

const getAgentRuntimeState = () => (config.__prod__ ? getProductionAgentRuntimeState() : getDevAgentRuntimeState());
const getAgentManagerRuntime = () => getAgentRuntimeState().agentManager;
const getActiveBackupsByScheduleId = () => getAgentRuntimeState().activeBackupsByScheduleId;
const getActiveBackupScheduleIdsByJobId = () => getAgentRuntimeState().activeBackupScheduleIdsByJobId;
const getActiveRestoresByRestoreId = () => getAgentRuntimeState().activeRestoresByRestoreId;

const clearActiveBackupRun = (scheduleId: number) => {
	const activeBackupsByScheduleId = getActiveBackupsByScheduleId();
	const activeBackupScheduleIdsByJobId = getActiveBackupScheduleIdsByJobId();
	const activeBackupRun = activeBackupsByScheduleId.get(scheduleId);
	if (!activeBackupRun) {
		return null;
	}

	activeBackupsByScheduleId.delete(scheduleId);
	activeBackupScheduleIdsByJobId.delete(activeBackupRun.jobId);
	return activeBackupRun;
};

const resolveActiveBackupRun = (scheduleId: number, result: BackupExecutionResult) => {
	const activeBackupRun = clearActiveBackupRun(scheduleId);
	if (!activeBackupRun) {
		return false;
	}

	activeBackupRun.resolve(result);
	return true;
};

const clearActiveRestoreRun = (restoreId: string) => {
	const activeRestoresByRestoreId = getActiveRestoresByRestoreId();
	const activeRestoreRun = activeRestoresByRestoreId.get(restoreId);
	if (!activeRestoreRun) {
		return null;
	}

	activeRestoresByRestoreId.delete(restoreId);
	return activeRestoreRun;
};

const resolveActiveRestoreRun = (restoreId: string, result: RestoreExecutionResult) => {
	const activeRestoreRun = clearActiveRestoreRun(restoreId);
	if (!activeRestoreRun) {
		return false;
	}

	activeRestoreRun.resolve(result);
	return true;
};

const cancelActiveBackupRunsForAgent = (agentId: string, message: string) => {
	const activeBackupsByScheduleId = getActiveBackupsByScheduleId();
	const matchingScheduleIds = [...activeBackupsByScheduleId.values()]
		.filter((activeBackupRun) => activeBackupRun.agentId === agentId)
		.map((activeBackupRun) => activeBackupRun.scheduleId);

	for (const scheduleId of matchingScheduleIds) {
		resolveActiveBackupRun(scheduleId, { status: "cancelled", message });
	}
};

const cancelActiveRestoreRunsForAgent = (agentId: string, message: string) => {
	const activeRestoresByRestoreId = getActiveRestoresByRestoreId();
	const matchingRestoreIds = [...activeRestoresByRestoreId.values()]
		.filter((activeRestoreRun) => activeRestoreRun.agentId === agentId)
		.map((activeRestoreRun) => activeRestoreRun.restoreId);

	for (const restoreId of matchingRestoreIds) {
		resolveActiveRestoreRun(restoreId, { status: "cancelled", message });
	}
};

const getActiveBackupRun = (jobId: string, scheduleId: string, eventName: string, agentId: string) => {
	const trackedScheduleId = getActiveBackupScheduleIdsByJobId().get(jobId);
	if (trackedScheduleId === undefined) {
		logger.warn(`Received ${eventName} for unknown job ${jobId} from agent ${agentId}`);
		return null;
	}

	const activeBackupRun = getActiveBackupsByScheduleId().get(trackedScheduleId);
	if (!activeBackupRun) {
		logger.warn(`Received ${eventName} for inactive job ${jobId} from agent ${agentId}`);
		return null;
	}

	if (activeBackupRun.scheduleShortId !== scheduleId) {
		logger.warn(
			`Ignoring ${eventName} for job ${jobId} due to schedule mismatch ${scheduleId} from agent ${agentId}`,
		);
		return null;
	}

	if (activeBackupRun.agentId !== agentId) {
		logger.warn(`Ignoring ${eventName} for job ${jobId} from unexpected agent ${agentId}`);
		return null;
	}

	return activeBackupRun;
};

const getActiveRestoreRun = (restoreId: string, eventName: string, agentId: string) => {
	const activeRestoreRun = getActiveRestoresByRestoreId().get(restoreId);
	if (!activeRestoreRun) {
		logger.warn(`Received ${eventName} for unknown restore ${restoreId} from agent ${agentId}`);
		return null;
	}

	if (activeRestoreRun.agentId !== agentId) {
		logger.warn(`Ignoring ${eventName} for restore ${restoreId} from unexpected agent ${agentId}`);
		return null;
	}

	return activeRestoreRun;
};

const requestBackupCancellation = async (agentId: string, scheduleId: number) => {
	const activeBackupRun = getActiveBackupsByScheduleId().get(scheduleId);
	if (!activeBackupRun) {
		return false;
	}

	if (activeBackupRun.cancellationRequested) {
		return true;
	}

	activeBackupRun.cancellationRequested = true;

	const runtime = getAgentManagerRuntime();
	if (!runtime) {
		resolveActiveBackupRun(scheduleId, { status: "cancelled" });
		return true;
	}

	const cancelResult = await Effect.runPromise(
		runtime.cancelBackup(agentId, {
			jobId: activeBackupRun.jobId,
			scheduleId: activeBackupRun.scheduleShortId,
		}),
	);

	if (cancelResult) return true;

	logger.warn(
		`Failed to send backup cancellation for ${activeBackupRun.jobId}; waiting for the agent to report its outcome`,
	);

	return false;
};

const requestRestoreCancellation = async (agentId: string, restoreId: string) => {
	const activeRestoreRun = getActiveRestoresByRestoreId().get(restoreId);
	if (!activeRestoreRun) {
		return false;
	}

	if (activeRestoreRun.cancellationRequested) {
		return true;
	}

	activeRestoreRun.cancellationRequested = true;

	const runtime = getAgentManagerRuntime();
	if (!runtime) {
		resolveActiveRestoreRun(restoreId, { status: "cancelled" });
		return true;
	}

	try {
		if (await Effect.runPromise(runtime.cancelRestore(agentId, { restoreId }))) {
			return true;
		}

		logger.warn(
			`Failed to send restore cancellation for ${restoreId}; waiting for the agent to report its outcome`,
		);
	} catch (error) {
		logger.warn(`Failed to send restore cancellation for ${restoreId}: ${toMessage(error)}`);
	}

	return false;
};

const handleAgentManagerEvent = (event: AgentManagerEvent) => {
	switch (event.type) {
		case "agent.disconnected": {
			cancelActiveBackupRunsForAgent(
				event.agentId,
				"The connection to the backup agent was lost. Restart the backup to ensure it completes.",
			);
			cancelActiveRestoreRunsForAgent(
				event.agentId,
				"The connection to the restore agent was lost. Restart the restore to ensure it completes.",
			);
			break;
		}
		case "agent.protocolRejected": {
			logger.warn(`Rejected agent protocol for ${event.agentName} (${event.agentId}): ${event.payload.reason}`);
			break;
		}
		case "backup.started": {
			getActiveBackupRun(event.payload.jobId, event.payload.scheduleId, event.type, event.agentId);
			break;
		}
		case "backup.progress": {
			const activeBackupRun = getActiveBackupRun(
				event.payload.jobId,
				event.payload.scheduleId,
				event.type,
				event.agentId,
			);
			if (!activeBackupRun) {
				break;
			}

			activeBackupRun.onProgress(event.payload.progress);
			break;
		}
		case "backup.completed": {
			const activeBackupRun = getActiveBackupRun(
				event.payload.jobId,
				event.payload.scheduleId,
				event.type,
				event.agentId,
			);
			if (!activeBackupRun) {
				break;
			}

			resolveActiveBackupRun(activeBackupRun.scheduleId, {
				status: "completed",
				exitCode: event.payload.exitCode,
				result: event.payload.result,
				warningDetails: event.payload.warningDetails ?? null,
			});
			break;
		}
		case "backup.failed": {
			const activeBackupRun = getActiveBackupRun(
				event.payload.jobId,
				event.payload.scheduleId,
				event.type,
				event.agentId,
			);
			if (!activeBackupRun) {
				break;
			}

			resolveActiveBackupRun(activeBackupRun.scheduleId, {
				status: "failed",
				error: event.payload.errorDetails ?? event.payload.error,
			});
			break;
		}
		case "backup.cancelled": {
			const activeBackupRun = getActiveBackupRun(
				event.payload.jobId,
				event.payload.scheduleId,
				event.type,
				event.agentId,
			);
			if (!activeBackupRun) {
				break;
			}

			resolveActiveBackupRun(activeBackupRun.scheduleId, {
				status: "cancelled",
				message: activeBackupRun.cancellationRequested ? undefined : event.payload.message,
			});
			break;
		}
		case "restore.started": {
			getActiveRestoreRun(event.payload.restoreId, event.type, event.agentId);
			break;
		}
		case "restore.progress": {
			const activeRestoreRun = getActiveRestoreRun(event.payload.restoreId, event.type, event.agentId);
			if (!activeRestoreRun) {
				break;
			}

			activeRestoreRun.onProgress(event.payload.progress);
			break;
		}
		case "restore.completed": {
			const activeRestoreRun = getActiveRestoreRun(event.payload.restoreId, event.type, event.agentId);
			if (!activeRestoreRun) {
				break;
			}

			resolveActiveRestoreRun(activeRestoreRun.restoreId, {
				status: "completed",
				result: event.payload.result,
			});
			break;
		}
		case "restore.failed": {
			const activeRestoreRun = getActiveRestoreRun(event.payload.restoreId, event.type, event.agentId);
			if (!activeRestoreRun) {
				break;
			}

			resolveActiveRestoreRun(activeRestoreRun.restoreId, {
				status: "failed",
				error: event.payload.errorDetails ?? event.payload.error,
			});
			break;
		}
		case "restore.cancelled": {
			const activeRestoreRun = getActiveRestoreRun(event.payload.restoreId, event.type, event.agentId);
			if (!activeRestoreRun) {
				break;
			}

			resolveActiveRestoreRun(activeRestoreRun.restoreId, {
				status: "cancelled",
				message: activeRestoreRun.cancellationRequested ? undefined : event.payload.message,
			});
			break;
		}
	}
};

export const startAgentController = () => {
	const runtime = getAgentRuntimeState();

	return runEffectPromise(
		runtime.lifecycleSemaphore.withPermits(1)(
			Effect.gen(function* () {
				if (runtime.agentManager) return;

				const nextAgentManager = createAgentManagerRuntime(handleAgentManagerEvent);
				yield* nextAgentManager.start;
				runtime.agentManager = nextAgentManager;
			}),
		),
	);
};

export const stopAgentController = () => {
	const runtime = getAgentRuntimeState();

	return runEffectPromise(
		runtime.lifecycleSemaphore.withPermits(1)(
			Effect.gen(function* () {
				const localStop = yield* Effect.exit(stopLocalAgentRuntime(runtime));
				const agentManagerRuntime = runtime.agentManager;
				runtime.agentManager = null;
				const controllerStop = yield* Effect.exit(agentManagerRuntime?.stop ?? Effect.void);

				if (Exit.isFailure(localStop) && Exit.isFailure(controllerStop)) {
					return yield* Effect.fail(
						new AggregateError(
							[Cause.squash(localStop.cause), Cause.squash(controllerStop.cause)],
							"Failed to stop the local agent and agent controller",
						),
					);
				}
				if (Exit.isFailure(localStop)) return yield* Effect.failCause(localStop.cause);
				if (Exit.isFailure(controllerStop)) return yield* Effect.failCause(controllerStop.cause);
			}),
		),
	);
};

export const agentManager = {
	runBackup: async (agentId: string, request: AgentRunBackupRequest) => {
		const runtime = getAgentManagerRuntime();
		if (!runtime) {
			return {
				status: "unavailable",
				error: new Error(`Backup agent ${agentId} is not connected`),
			} satisfies BackupExecutionResult;
		}

		if (request.signal.aborted) {
			throw request.signal.reason || new Error("Operation aborted");
		}

		const completion = new Promise<BackupExecutionResult>((resolve) => {
			getActiveBackupsByScheduleId().set(request.scheduleId, {
				agentId,
				scheduleId: request.scheduleId,
				jobId: request.payload.jobId,
				scheduleShortId: request.payload.scheduleId,
				onProgress: request.onProgress,
				resolve,
				cancellationRequested: false,
			});
			getActiveBackupScheduleIdsByJobId().set(request.payload.jobId, request.scheduleId);
		});

		try {
			if (!(await Effect.runPromise(runtime.sendBackup(agentId, request.payload)))) {
				clearActiveBackupRun(request.scheduleId);
				return {
					status: "unavailable",
					error: new Error(`Failed to send backup command to agent ${agentId}`),
				} satisfies BackupExecutionResult;
			}

			const cancelOnAbort = () => {
				const cancellation = requestBackupCancellation(agentId, request.scheduleId);
				void cancellation.catch((error) => {
					const message = toMessage(error);
					logger.warn(`Failed to request backup cancellation for ${request.payload.jobId}: ${message}`);
				});
			};
			request.signal.addEventListener("abort", cancelOnAbort, { once: true });
			if (request.signal.aborted) {
				cancelOnAbort();
			}

			return completion.finally(() => {
				request.signal.removeEventListener("abort", cancelOnAbort);
			});
		} catch (error) {
			clearActiveBackupRun(request.scheduleId);
			throw error;
		}
	},
	cancelBackup: async (agentId: string, scheduleId: number) => {
		return requestBackupCancellation(agentId, scheduleId);
	},
	runFilesystemCommand: async (agentId: string, command: FilesystemCommand): Promise<FilesystemCommandResult> => {
		const runtime = getAgentManagerRuntime();
		if (!runtime) {
			throw new Error(`Filesystem agent ${agentId} is not connected`);
		}

		const response = await Effect.runPromise(runtime.runFilesystemCommand(agentId, command));
		if (!response) {
			throw new Error(`Failed to send filesystem command ${command.name} to agent ${agentId}`);
		}

		if (response.status === "error") {
			throw new Error(response.error);
		}

		return response.command;
	},
	startRestore: async (agentId: string, request: AgentStartRestoreRequest): Promise<AgentRestoreStartResult> => {
		const runtime = getAgentManagerRuntime();
		if (!runtime) {
			return {
				status: "unavailable",
				error: new Error(`Restore agent ${agentId} is not connected`),
			};
		}

		if (request.signal.aborted) {
			throw request.signal.reason || new Error("Operation aborted");
		}

		const completion = new Promise<RestoreExecutionResult>((resolve) => {
			getActiveRestoresByRestoreId().set(request.payload.restoreId, {
				agentId,
				restoreId: request.payload.restoreId,
				onProgress: request.onProgress,
				resolve,
				cancellationRequested: false,
			});
		});

		try {
			if (!(await Effect.runPromise(runtime.sendRestore(agentId, request.payload)))) {
				clearActiveRestoreRun(request.payload.restoreId);
				return {
					status: "unavailable",
					error: new Error(`Failed to send restore command to agent ${agentId}`),
				};
			}

			const cancelOnAbort = () => {
				void requestRestoreCancellation(agentId, request.payload.restoreId);
			};
			request.signal.addEventListener("abort", cancelOnAbort, { once: true });
			if (request.signal.aborted) {
				cancelOnAbort();
			}

			return {
				status: "started",
				result: completion.finally(() => {
					request.signal.removeEventListener("abort", cancelOnAbort);
				}),
			};
		} catch (error) {
			clearActiveRestoreRun(request.payload.restoreId);
			throw error;
		}
	},
	cancelRestore: async (agentId: string, restoreId: string) => {
		return requestRestoreCancellation(agentId, restoreId);
	},
};

const runLocalAgent = (
	runtime: AgentRuntimeState,
	manager: AgentManagerRuntime,
	controllerUrl: string,
	ready: Deferred.Deferred<void, Error>,
) =>
	Effect.scoped(
		Effect.gen(function* () {
			const agentProcess = yield* spawnLocalAgentProcess(runtime, controllerUrl);

			const checkReadiness = Effect.tryPromise({
				try: () => manager.waitForAgentReady(LOCAL_AGENT_ID),
				catch: (error) => (error instanceof Error ? error : new Error(String(error))),
			});
			const isReady = yield* Effect.raceFirst(
				checkReadiness,
				agentProcess.exited.pipe(
					Effect.andThen(Effect.fail(new Error("Local agent exited before becoming ready"))),
				),
			);

			if (!isReady) {
				return yield* Effect.fail(new Error("Local agent did not become ready before startup"));
			}
			yield* Deferred.succeed(ready, undefined);

			yield* agentProcess.exited;
		}),
	);

const stopLocalAgentRuntime = (runtime: AgentRuntimeState) =>
	Effect.gen(function* () {
		const supervisor = runtime.localAgentSupervisor;
		if (supervisor) {
			const completed = yield* Fiber.poll(supervisor.fiber);
			const result = yield* Fiber.interrupt(supervisor.fiber);
			runtime.localAgentSupervisor = null;

			if (Option.isNone(completed) && Exit.isFailure(result) && !Cause.isInterruptedOnly(result.cause)) {
				return yield* Effect.failCause(result.cause);
			}
		}

		const child = runtime.localAgent;
		if (child) {
			yield* stopLocalAgentProcess(child);
			runtime.localAgent = null;
		}
	});

const refreshLocalAgentReadiness = (readiness: { current: Deferred.Deferred<void, Error> }) =>
	Effect.gen(function* () {
		if (yield* Deferred.isDone(readiness.current)) {
			readiness.current = yield* Deferred.make<void, Error>();
		}

		return readiness.current;
	});

export const startLocalAgent = () => {
	const runtime = getAgentRuntimeState();
	const start = runtime.lifecycleSemaphore.withPermits(1)(
		Effect.gen(function* () {
			const supervisor = runtime.localAgentSupervisor;
			if (supervisor && Option.isNone(yield* Fiber.poll(supervisor.fiber))) {
				const child = runtime.localAgent;
				if (!child || child.exitCode !== null || child.signalCode !== null) {
					return yield* refreshLocalAgentReadiness(supervisor.readiness);
				}

				return supervisor.readiness.current;
			}

			yield* stopLocalAgentRuntime(runtime);
			const manager = runtime.agentManager;
			if (!manager) {
				return yield* Effect.fail(
					new Error(`startLocalAgent cannot spawn ${LOCAL_AGENT_ID} because the controller is not running`),
				);
			}
			const controllerUrl = manager.getControllerUrl();
			if (!controllerUrl) {
				return yield* Effect.fail(
					new Error(
						`startLocalAgent cannot spawn ${LOCAL_AGENT_ID} because the controller URL is not available`,
					),
				);
			}

			const readiness = { current: yield* Deferred.make<void, Error>() };
			const restart = Effect.gen(function* () {
				const ready = yield* runtime.lifecycleSemaphore.withPermits(1)(refreshLocalAgentReadiness(readiness));

				yield* Effect.sleep(1_000);
				yield* runLocalAgent(runtime, manager, controllerUrl, ready);
			}).pipe(
				Effect.catchAllCause((cause) => {
					if (Cause.isInterruptedOnly(cause)) return Effect.failCause(cause);

					return Effect.gen(function* () {
						yield* logger.effect.error(`Failed to restart local agent: ${toMessage(Cause.squash(cause))}`);
						if (runtime.localAgent) {
							yield* waitForLocalAgentExit(runtime.localAgent);
							yield* stopLocalAgentProcess(runtime.localAgent);
							runtime.localAgent = null;
						}
					});
				}),
			);
			const fiber = yield* Effect.forkDaemon(
				runLocalAgent(runtime, manager, controllerUrl, readiness.current).pipe(
					Effect.andThen(Effect.forever(restart)),
					Effect.onExit((exit) => {
						if (Exit.isFailure(exit) && !Cause.isInterruptedOnly(exit.cause)) {
							return Deferred.failCause(readiness.current, exit.cause);
						}

						return Deferred.fail(
							readiness.current,
							new Error("Local agent startup was interrupted by shutdown"),
						);
					}),
				),
			);
			runtime.localAgentSupervisor = { fiber, readiness };

			return readiness.current;
		}),
	);

	return runEffectPromise(start.pipe(Effect.flatMap(Deferred.await)));
};

// fallow-ignore-next-line unused-export
export const stopLocalAgent = () => {
	const runtime = getAgentRuntimeState();

	return runEffectPromise(runtime.lifecycleSemaphore.withPermits(1)(stopLocalAgentRuntime(runtime)));
};
