import { logger } from "@zerobyte/core/node";
import type { ChildProcess } from "node:child_process";
import type {
	BackupRunPayload,
	RestoreRunPayload,
	VolumeCommand,
	VolumeCommandResult,
} from "@zerobyte/contracts/agent-protocol";
import { Effect } from "effect";
import { toMessage } from "../../utils/errors";
import { createAgentManagerRuntime, type AgentManagerEvent } from "./controller/server";
import { LOCAL_AGENT_ID } from "./constants";
import { spawnLocalAgentProcess, stopLocalAgentProcess } from "./local/process";
import {
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

const getAgentRuntimeState = getDevAgentRuntimeState;
export const getAgentManagerRuntime = () => getAgentRuntimeState().agentManager;
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

const enqueueAgentManagerLifecycleTransition = <Result>(
	transition: (runtime: AgentRuntimeState) => Promise<Result>,
) => {
	const runtime = getAgentRuntimeState();
	const runTransition = () => transition(runtime);
	const operation = runtime.lifecycleTail.then(runTransition);
	runtime.lifecycleTail = operation.then(
		() => undefined,
		() => undefined,
	);
	return operation;
};

export const startAgentController = () =>
	enqueueAgentManagerLifecycleTransition(async (runtime) => {
		if (runtime.agentManager) return;

		const nextAgentManager = createAgentManagerRuntime(handleAgentManagerEvent);
		await Effect.runPromise(nextAgentManager.start);
		runtime.agentManager = nextAgentManager;
	});

export const stopAgentController = () => {
	const currentRuntime = getAgentRuntimeState();
	requestLocalAgentStop(currentRuntime);
	return enqueueAgentManagerLifecycleTransition(async (runtime) => {
		let localAgentStopFailed = false;
		let localAgentStopError: unknown;
		try {
			await stopLocalAgentNow(runtime);
		} catch (error) {
			localAgentStopFailed = true;
			localAgentStopError = error;
		}

		const agentManagerRuntime = runtime.agentManager;
		runtime.agentManager = null;
		try {
			if (agentManagerRuntime) {
				await Effect.runPromise(agentManagerRuntime.stop);
			}
		} catch (agentManagerStopError) {
			if (localAgentStopFailed) {
				throw new AggregateError(
					[localAgentStopError, agentManagerStopError],
					"Failed to stop the local agent and agent controller",
				);
			}
			throw agentManagerStopError;
		}

		if (localAgentStopFailed) {
			throw localAgentStopError;
		}
	});
};

async function runAgentVolumeCommand(
	agentId: string,
	organizationId: string,
	command: VolumeCommand,
): Promise<VolumeCommandResult> {
	const runtime = getAgentManagerRuntime();

	if (!runtime) throw new Error(`Volume agent ${agentId} is not connected`);

	const response = await Effect.runPromise(runtime.runVolumeCommand(agentId, organizationId, command));

	if (!response) throw new Error(`Failed to send volume command ${command.name} to agent ${agentId}`);
	if (response.status === "error") throw new Error(response.error);

	return response.command;
}

export const agentManager = {
	isAgentReady: async (agentId: string) => {
		const runtime = getAgentManagerRuntime();

		if (!runtime) return false;
		return runtime.waitForAgentReady(agentId, 0);
	},
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
	runVolumeCommand: runAgentVolumeCommand,
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
	disconnectAgent: async (agentId: string) => {
		const runtime = getAgentManagerRuntime();

		if (!runtime) return false;

		try {
			return await runtime.disconnectAgent(agentId);
		} catch {
			logger.warn(`Failed to disconnect agent ${agentId}`);
			return false;
		}
	},
};

const isCurrentLocalAgentGeneration = (runtime: AgentRuntimeState, generation: number) => {
	return runtime.localAgentDesiredRunning && runtime.localAgentGeneration === generation;
};

const stopPublishedLocalAgent = async (runtime: AgentRuntimeState, agentProcess: ChildProcess) => {
	if (runtime.localAgent === agentProcess) {
		runtime.localAgent = null;
	}

	runtime.isStoppingLocalAgent = true;

	try {
		await stopLocalAgentProcess(agentProcess);
	} finally {
		runtime.isStoppingLocalAgent = false;
	}
};

const scheduleLocalAgentRestart = (runtime: AgentRuntimeState, generation: number) => {
	const restartIsNeeded = isCurrentLocalAgentGeneration(runtime, generation);
	const restartIsScheduled = runtime.localAgentRestartTimeout !== null;

	if (!restartIsNeeded || restartIsScheduled) {
		return;
	}

	const restartTimeout = setTimeout(() => {
		const restart = async () => {
			const timeoutIsCurrent = runtime.localAgentRestartTimeout === restartTimeout;
			const generationIsCurrent = isCurrentLocalAgentGeneration(runtime, generation);

			if (!timeoutIsCurrent || !generationIsCurrent) {
				return;
			}

			runtime.localAgentRestartTimeout = null;
			await ensureLocalAgent(runtime, generation);
		};

		const restartOperation = enqueueAgentManagerLifecycleTransition(restart);

		void restartOperation.catch((error) => {
			logger.error(`Failed to restart local agent: ${toMessage(error)}`);
			scheduleLocalAgentRestart(runtime, generation);
		});
	}, 1_000);
	runtime.localAgentRestartTimeout = restartTimeout;
};

const ensureLocalAgent = async (runtime: AgentRuntimeState, generation: number) => {
	if (!isCurrentLocalAgentGeneration(runtime, generation)) {
		return;
	}

	const pendingRestart = runtime.localAgentRestartTimeout;
	if (pendingRestart) {
		clearTimeout(pendingRestart);
		runtime.localAgentRestartTimeout = null;
	}

	const currentAgent = runtime.localAgent;
	const currentAgentIsHealthy =
		currentAgent !== null && currentAgent.exitCode === null && currentAgent.signalCode === null;

	if (currentAgentIsHealthy) {
		return;
	}

	if (currentAgent) {
		runtime.localAgent = null;
	}

	const agentManager = runtime.agentManager;

	if (!agentManager) {
		throw new Error(
			`startLocalAgent cannot spawn ${LOCAL_AGENT_ID} because runtime.agentManager is missing; waitForAgentReady cannot check readiness`,
		);
	}

	const controllerUrl = agentManager.getControllerUrl();

	if (!controllerUrl) {
		throw new Error(`startLocalAgent cannot spawn ${LOCAL_AGENT_ID} because the controller URL is not available`);
	}

	const agentProcess = await spawnLocalAgentProcess(controllerUrl);
	const generationIsCurrent = isCurrentLocalAgentGeneration(runtime, generation);
	const managerIsCurrent = runtime.agentManager === agentManager;

	if (!generationIsCurrent || !managerIsCurrent) {
		await stopLocalAgentProcess(agentProcess);
		return;
	}

	runtime.localAgent = agentProcess;
	agentProcess.on("exit", (code, signal) => {
		logger.info(`Agent process exited with code ${code} and signal ${signal}`);
		const handleExit = async () => {
			const childIsCurrent = runtime.localAgent === agentProcess;
			const generationIsStillCurrent = runtime.localAgentGeneration === generation;

			if (!childIsCurrent || !generationIsStillCurrent) {
				return;
			}

			runtime.localAgent = null;
			if (!runtime.localAgentDesiredRunning) {
				return;
			}

			scheduleLocalAgentRestart(runtime, generation);
		};

		const exitOperation = enqueueAgentManagerLifecycleTransition(handleExit);

		void exitOperation.catch((error) => {
			logger.error(
				`Failed to handle local agent exit: ${error instanceof Error ? error.message : String(error)}`,
			);
		});
	});

	let agentIsReady: boolean;

	try {
		agentIsReady = await agentManager.waitForAgentReady(LOCAL_AGENT_ID);
	} catch (error) {
		await stopPublishedLocalAgent(runtime, agentProcess);
		throw error;
	}

	const generationRemainsCurrent = isCurrentLocalAgentGeneration(runtime, generation);
	const childRemainsCurrent = runtime.localAgent === agentProcess;
	const managerRemainsCurrent = runtime.agentManager === agentManager;

	if (!generationRemainsCurrent || !childRemainsCurrent || !managerRemainsCurrent) {
		await stopPublishedLocalAgent(runtime, agentProcess);
		return;
	}

	if (!agentIsReady) {
		await stopPublishedLocalAgent(runtime, agentProcess);
		throw new Error("Local agent did not become ready before startup");
	}
};

export const startLocalAgent = () => {
	const runtime = getAgentRuntimeState();
	const wasDesiredRunning = runtime.localAgentDesiredRunning;

	runtime.localAgentDesiredRunning = true;

	if (!wasDesiredRunning) {
		runtime.localAgentGeneration += 1;
	}

	const generation = runtime.localAgentGeneration;
	const ensureAgent = () => ensureLocalAgent(runtime, generation);

	return enqueueAgentManagerLifecycleTransition(ensureAgent);
};

const requestLocalAgentStop = (runtime: AgentRuntimeState) => {
	runtime.localAgentDesiredRunning = false;
	runtime.localAgentGeneration += 1;
};

const stopLocalAgentNow = async (runtime: AgentRuntimeState) => {
	const restartTimeout = runtime.localAgentRestartTimeout;

	if (restartTimeout) {
		clearTimeout(restartTimeout);
		runtime.localAgentRestartTimeout = null;
	}

	const agentProcess = runtime.localAgent;
	if (agentProcess) await stopPublishedLocalAgent(runtime, agentProcess);
};

// fallow-ignore-next-line unused-export
export const stopLocalAgent = () => {
	const runtime = getAgentRuntimeState();

	requestLocalAgentStop(runtime);

	return enqueueAgentManagerLifecycleTransition(stopLocalAgentNow);
};
