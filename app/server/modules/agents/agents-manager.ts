import { logger } from "@zerobyte/core/node";
import type { BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import { Effect } from "effect";
import { config } from "../../core/config";
import { createAgentManagerRuntime, type AgentManagerEvent } from "./controller/server";
import { spawnLocalAgentProcess, stopLocalAgentProcess } from "./local/process";
import type { BackupExecutionProgress, BackupExecutionResult } from "./helpers/runtime-state";
import { createAgentRuntimeState } from "./helpers/runtime-state";
import { getDevAgentRuntimeState } from "./helpers/runtime-state.dev";
export type { BackupExecutionProgress, BackupExecutionResult } from "./helpers/runtime-state";
export type { ProcessWithAgentRuntime } from "./helpers/runtime-state.dev";

const productionRuntimeState = createAgentRuntimeState();

type AgentRunBackupRequest = {
	scheduleId: number;
	payload: BackupRunPayload;
	signal: AbortSignal;
	onProgress: (progress: BackupExecutionProgress) => void;
};

const getAgentRuntimeState = () => (config.__prod__ ? productionRuntimeState : getDevAgentRuntimeState());
const getAgentManagerRuntime = () => getAgentRuntimeState().agentManager;
const getActiveBackupsByScheduleId = () => getAgentRuntimeState().activeBackupsByScheduleId;
const getActiveBackupScheduleIdsByJobId = () => getAgentRuntimeState().activeBackupScheduleIdsByJobId;

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

const cancelActiveBackupRunsForAgent = (agentId: string, message: string) => {
	const activeBackupsByScheduleId = getActiveBackupsByScheduleId();
	const matchingScheduleIds = [...activeBackupsByScheduleId.values()]
		.filter((activeBackupRun) => activeBackupRun.agentId === agentId)
		.map((activeBackupRun) => activeBackupRun.scheduleId);

	for (const scheduleId of matchingScheduleIds) {
		resolveActiveBackupRun(scheduleId, { status: "cancelled", message });
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
		logger.warn(`Ignoring ${eventName} for job ${jobId} due to schedule mismatch ${scheduleId} from agent ${agentId}`);
		return null;
	}

	return activeBackupRun;
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

const handleAgentManagerEvent = (event: AgentManagerEvent) => {
	switch (event.type) {
		case "agent.disconnected": {
			cancelActiveBackupRunsForAgent(
				event.agentId,
				"The connection to the backup agent was lost. Restart the backup to ensure it completes.",
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
	}
};

export const startAgentController = async () => {
	const runtime = getAgentRuntimeState();

	if (runtime.agentManager) {
		await Effect.runPromise(runtime.agentManager.stop);
		runtime.agentManager = null;
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
};

export const startLocalAgent = async () => {
	await spawnLocalAgentProcess(getAgentRuntimeState());
};

// fallow-ignore-next-line unused-export
export const stopLocalAgent = async () => {
	await stopLocalAgentProcess(getAgentRuntimeState());
};
