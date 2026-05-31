import { logger } from "@zerobyte/core/node";
import type {
	BackupRunPayload,
	RestoreRunPayload,
	VolumeCommand,
	VolumeCommandResult,
} from "@zerobyte/contracts/agent-protocol";
import { Effect } from "effect";
import { config } from "../../core/config";
import { createAgentManagerRuntime, type AgentManagerEvent } from "./controller/server";
import { LOCAL_AGENT_ID } from "./constants";
import { spawnLocalAgentProcess, stopLocalAgentProcess } from "./local/process";
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
	onStarted: () => void;
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

	if (
		await Effect.runPromise(
			runtime.cancelBackup(agentId, {
				jobId: activeBackupRun.jobId,
				scheduleId: activeBackupRun.scheduleShortId,
			}),
		)
	) {
		return true;
	}

	resolveActiveBackupRun(scheduleId, { status: "cancelled" });
	return true;
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

	if (await Effect.runPromise(runtime.cancelRestore(agentId, { restoreId }))) {
		return true;
	}

	resolveActiveRestoreRun(restoreId, { status: "cancelled" });
	return true;
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
			const activeRestoreRun = getActiveRestoreRun(event.payload.restoreId, event.type, event.agentId);
			if (!activeRestoreRun) {
				break;
			}

			activeRestoreRun.onStarted();
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

export const startAgentController = async () => {
	const runtime = getAgentRuntimeState();

	if (runtime.agentManager) {
		await Effect.runPromise(runtime.agentManager.stop);
		runtime.agentManager = null;
	}

	if (!config.flags.enableLocalAgent) {
		return;
	}

	const nextAgentManager = createAgentManagerRuntime(handleAgentManagerEvent);
	await Effect.runPromise(nextAgentManager.start);
	runtime.agentManager = nextAgentManager;
};

export const stopAgentController = async () => {
	const runtime = getAgentRuntimeState();
	const agentManagerRuntime = runtime.agentManager;
	runtime.agentManager = null;
	if (agentManagerRuntime) {
		await Effect.runPromise(agentManagerRuntime.stop);
	}
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

			if (request.signal.aborted) {
				await requestBackupCancellation(agentId, request.scheduleId);
			}

			return completion;
		} catch (error) {
			clearActiveBackupRun(request.scheduleId);
			throw error;
		}
	},
	cancelBackup: async (agentId: string, scheduleId: number) => {
		return requestBackupCancellation(agentId, scheduleId);
	},
	runVolumeCommand: async (agentId: string, command: VolumeCommand): Promise<VolumeCommandResult> => {
		const runtime = getAgentManagerRuntime();
		if (!runtime) {
			throw new Error(`Volume agent ${agentId} is not connected`);
		}

		const response = await Effect.runPromise(runtime.runVolumeCommand(agentId, command));
		if (!response) {
			throw new Error(`Failed to send volume command ${command.name} to agent ${agentId}`);
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
				onStarted: request.onStarted,
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

			if (request.signal.aborted) {
				await requestRestoreCancellation(agentId, request.payload.restoreId);
			}

			return { status: "started", result: completion };
		} catch (error) {
			clearActiveRestoreRun(request.payload.restoreId);
			throw error;
		}
	},
	cancelRestore: async (agentId: string, restoreId: string) => {
		return requestRestoreCancellation(agentId, restoreId);
	},
};

export const startLocalAgent = async () => {
	const runtime = getAgentRuntimeState();

	if (!runtime.agentManager) {
		throw new Error(
			`startLocalAgent cannot spawn ${LOCAL_AGENT_ID} because runtime.agentManager is missing; waitForAgentReady cannot check readiness`,
		);
	}

	const controllerUrl = runtime.agentManager.getControllerUrl();
	if (!controllerUrl) {
		throw new Error(`startLocalAgent cannot spawn ${LOCAL_AGENT_ID} because the controller URL is not available`);
	}

	await spawnLocalAgentProcess(runtime, controllerUrl);

	if (!(await runtime.agentManager.waitForAgentReady(LOCAL_AGENT_ID))) {
		throw new Error("Local agent did not become ready before startup");
	}
};

// fallow-ignore-next-line unused-export
export const stopLocalAgent = async () => {
	await stopLocalAgentProcess(getAgentRuntimeState());
};
