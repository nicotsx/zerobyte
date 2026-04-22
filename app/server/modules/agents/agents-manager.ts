import { logger } from "@zerobyte/core/node";
import type { BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import { config } from "../../core/config";
import type { AgentBackupEventHandlers } from "./controller/server";
import { spawnLocalAgentProcess, stopLocalAgentProcess } from "./local/process";
import type { BackupExecutionProgress, BackupExecutionResult } from "./helpers/runtime-state";
import { createAgentRuntimeState } from "./helpers/runtime-state";
import { getDevAgentRuntimeState } from "./helpers/runtime-state.dev";
export type { BackupExecutionProgress, BackupExecutionResult } from "./helpers/runtime-state";
export type { ProcessWithAgentRuntime } from "./helpers/runtime-state.dev";

const productionRuntimeState = createAgentRuntimeState();

export type AgentRunBackupRequest = {
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
		await runtime.cancelBackup(agentId, {
			jobId: activeBackupRun.jobId,
			scheduleId: activeBackupRun.scheduleShortId,
		})
	) {
		return true;
	}

	resolveActiveBackupRun(scheduleId, { status: "cancelled" });
	return true;
};

const backupEventHandlers: AgentBackupEventHandlers = {
	onBackupStarted: ({ agentId, payload }) => {
		getActiveBackupRun(payload.jobId, payload.scheduleId, "backup.started", agentId);
	},
	onBackupProgress: ({ agentId, payload }) => {
		const activeBackupRun = getActiveBackupRun(payload.jobId, payload.scheduleId, "backup.progress", agentId);
		if (!activeBackupRun) {
			return;
		}

		activeBackupRun.onProgress(payload.progress);
	},
	onBackupCompleted: ({ agentId, payload }) => {
		const activeBackupRun = getActiveBackupRun(payload.jobId, payload.scheduleId, "backup.completed", agentId);
		if (!activeBackupRun) {
			return;
		}

		resolveActiveBackupRun(activeBackupRun.scheduleId, {
			status: "completed",
			exitCode: payload.exitCode,
			result: payload.result,
			warningDetails: payload.warningDetails ?? null,
		});
	},
	onBackupFailed: ({ agentId, payload }) => {
		const activeBackupRun = getActiveBackupRun(payload.jobId, payload.scheduleId, "backup.failed", agentId);
		if (!activeBackupRun) {
			return;
		}

		resolveActiveBackupRun(activeBackupRun.scheduleId, {
			status: "failed",
			error: payload.errorDetails ?? payload.error,
		});
	},
	onBackupCancelled: ({ agentId, payload }) => {
		const activeBackupRun = getActiveBackupRun(payload.jobId, payload.scheduleId, "backup.cancelled", agentId);
		if (!activeBackupRun) {
			return;
		}

		resolveActiveBackupRun(activeBackupRun.scheduleId, {
			status: "cancelled",
			message: activeBackupRun.cancellationRequested ? undefined : payload.message,
		});
	},
};

export const startAgentRuntime = async () => {
	const runtime = getAgentRuntimeState();

	if (runtime.agentManager) {
		await runtime.agentManager.stop();
		runtime.agentManager = null;
	}

	const { createAgentManagerRuntime } = await import("./controller/server");
	const nextAgentManager = createAgentManagerRuntime();
	nextAgentManager.setBackupEventHandlers(backupEventHandlers);

	await nextAgentManager.start();
	runtime.agentManager = nextAgentManager;
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
			if (!(await runtime.sendBackup(agentId, request.payload))) {
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

export const spawnLocalAgent = async () => {
	await spawnLocalAgentProcess(getAgentRuntimeState());
};

// fallow-ignore-next-line unused-export
export const stopLocalAgent = async () => {
	await stopLocalAgentProcess(getAgentRuntimeState());
};

export const stopAgentRuntime = async () => {
	await getAgentManagerRuntime()?.stop();
	await stopLocalAgent();
};
