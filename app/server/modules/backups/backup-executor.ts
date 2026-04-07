import type { BackupSchedule, Volume, Repository } from "../../db/schema";
import { logger } from "@zerobyte/core/node";
import { resticDeps } from "../../core/restic";
import type { ResticBackupOutputDto } from "@zerobyte/core/restic";
import type { BackupProgressPayload, BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import { agentManager } from "../agents/agents-manager";
import { getVolumePath } from "../volumes/helpers";
import { decryptRepositoryConfig } from "../repositories/repository-config-secrets";
import { createBackupOptions } from "./backup.helpers";

const LOCAL_AGENT_ID = "local";

type BackupExecutionRequest = {
	scheduleId: number;
	jobId: string;
	schedule: BackupSchedule;
	volume: Volume;
	repository: Repository;
	organizationId: string;
	signal: AbortSignal;
	onProgress: (progress: BackupExecutionProgress) => void;
};

type ActiveBackupExecution = {
	scheduleId: number;
	scheduleShortId: string;
	onProgress: (progress: BackupExecutionProgress) => void;
	resolve: (result: BackupExecutionResult) => void;
};

export type BackupExecutionProgress = BackupProgressPayload["progress"];

export type BackupExecutionResult =
	| {
			status: "unavailable";
			error: Error;
	  }
	| {
			status: "completed";
			exitCode: number;
			result: ResticBackupOutputDto | null;
			warningDetails: string | null;
	  }
	| {
			status: "failed";
			error: string;
	  }
	| {
			status: "cancelled";
			message?: string;
	  };

const activeExecutionsByJobId = new Map<string, ActiveBackupExecution>();
const activeExecutionJobIdsByScheduleId = new Map<number, string>();
const requestedCancellationsByScheduleId = new Set<number>();
const activeControllersByScheduleId = new Map<number, AbortController>();

const createBackupRunPayload = async ({
	jobId,
	schedule,
	volume,
	repository,
	organizationId,
}: BackupExecutionRequest): Promise<BackupRunPayload> => {
	const sourcePath = getVolumePath(volume);
	const { signal: _, ...options } = createBackupOptions(schedule, sourcePath);
	const repositoryConfig = await decryptRepositoryConfig(repository.config);
	const encryptedResticPassword = await resticDeps.getOrganizationResticPassword(organizationId);
	const resticPassword = await resticDeps.resolveSecret(encryptedResticPassword);

	return {
		jobId,
		scheduleId: schedule.shortId,
		organizationId,
		sourcePath,
		repositoryConfig,
		options: {
			...options,
			compressionMode: repository.compressionMode ?? "auto",
		},
		runtime: {
			password: resticPassword,
			cacheDir: resticDeps.resticCacheDir,
			passFile: resticDeps.resticPassFile,
			defaultExcludes: resticDeps.defaultExcludes,
			rcloneConfigFile: resticDeps.rcloneConfigFile,
			hostname: resticDeps.hostname,
		},
	};
};

const clearActiveExecution = (jobId: string) => {
	const activeExecution = activeExecutionsByJobId.get(jobId);
	if (!activeExecution) {
		return null;
	}

	activeExecutionsByJobId.delete(jobId);
	activeExecutionJobIdsByScheduleId.delete(activeExecution.scheduleId);
	return activeExecution;
};

const clearExecutionState = (jobId: string, scheduleId: number) => {
	requestedCancellationsByScheduleId.delete(scheduleId);
	clearActiveExecution(jobId);
};

const resolveExecution = (jobId: string, activeExecution: ActiveBackupExecution, result: BackupExecutionResult) => {
	clearExecutionState(jobId, activeExecution.scheduleId);
	activeExecution.resolve(result);
};

const getActiveExecution = (jobId: string, scheduleId: string, eventName: string, agentId: string) => {
	const activeExecution = activeExecutionsByJobId.get(jobId);
	if (!activeExecution) {
		logger.warn(`Received ${eventName} for unknown job ${jobId} from agent ${agentId}`);
		return null;
	}

	if (activeExecution.scheduleShortId !== scheduleId) {
		logger.warn(`Ignoring ${eventName} for job ${jobId} due to schedule mismatch ${scheduleId} from agent ${agentId}`);
		return null;
	}

	return activeExecution;
};

agentManager.setBackupEventHandlers({
	onBackupStarted: ({ agentId, payload }) => {
		getActiveExecution(payload.jobId, payload.scheduleId, "backup.started", agentId);
	},
	onBackupProgress: ({ agentId, payload }) => {
		const activeExecution = getActiveExecution(payload.jobId, payload.scheduleId, "backup.progress", agentId);
		if (!activeExecution) {
			return;
		}

		activeExecution.onProgress(payload.progress);
	},
	onBackupCompleted: ({ agentId, payload }) => {
		const activeExecution = getActiveExecution(payload.jobId, payload.scheduleId, "backup.completed", agentId);
		if (!activeExecution) {
			return;
		}

		resolveExecution(payload.jobId, activeExecution, {
			status: "completed",
			exitCode: payload.exitCode,
			result: payload.result,
			warningDetails: payload.warningDetails ?? null,
		});
	},
	onBackupFailed: ({ agentId, payload }) => {
		const activeExecution = getActiveExecution(payload.jobId, payload.scheduleId, "backup.failed", agentId);
		if (!activeExecution) {
			return;
		}

		resolveExecution(payload.jobId, activeExecution, {
			status: "failed",
			error: payload.errorDetails ?? payload.error,
		});
	},
	onBackupCancelled: ({ agentId, payload }) => {
		const activeExecution = getActiveExecution(payload.jobId, payload.scheduleId, "backup.cancelled", agentId);
		if (!activeExecution) {
			return;
		}

		const wasRequested = requestedCancellationsByScheduleId.has(activeExecution.scheduleId);
		resolveExecution(payload.jobId, activeExecution, {
			status: "cancelled",
			message: wasRequested ? undefined : payload.message,
		});
	},
});

export const backupExecutor = {
	track: (scheduleId: number) => {
		const abortController = new AbortController();
		activeControllersByScheduleId.set(scheduleId, abortController);
		return abortController;
	},
	untrack: (scheduleId: number, abortController: AbortController) => {
		if (activeControllersByScheduleId.get(scheduleId) === abortController) {
			activeControllersByScheduleId.delete(scheduleId);
		}
	},
	execute: async (request: Omit<BackupExecutionRequest, "jobId">) => {
		const jobId = Bun.randomUUIDv7();
		const completion = new Promise<BackupExecutionResult>((resolve) => {
			activeExecutionsByJobId.set(jobId, {
				scheduleId: request.scheduleId,
				scheduleShortId: request.schedule.shortId,
				onProgress: request.onProgress,
				resolve,
			});
			activeExecutionJobIdsByScheduleId.set(request.scheduleId, jobId);
		});

		try {
			if (request.signal.aborted) {
				throw request.signal.reason || new Error("Operation aborted");
			}

			const payload = await createBackupRunPayload({ ...request, jobId });

			if (request.signal.aborted) {
				throw request.signal.reason || new Error("Operation aborted");
			}

			if (!agentManager.sendBackup(LOCAL_AGENT_ID, payload)) {
				clearExecutionState(jobId, request.scheduleId);
				return {
					status: "unavailable",
					error: new Error("Local backup agent is not connected"),
				} satisfies BackupExecutionResult;
			}

			return completion;
		} catch (error) {
			clearExecutionState(jobId, request.scheduleId);
			throw error;
		}
	},
	cancel: (scheduleId: number) => {
		const abortController = activeControllersByScheduleId.get(scheduleId);
		if (abortController) {
			abortController.abort();
		}

		const jobId = activeExecutionJobIdsByScheduleId.get(scheduleId);
		if (!jobId) {
			return abortController !== undefined;
		}

		const activeExecution = activeExecutionsByJobId.get(jobId);
		if (!activeExecution) {
			activeExecutionJobIdsByScheduleId.delete(scheduleId);
			requestedCancellationsByScheduleId.delete(scheduleId);
			return false;
		}

		requestedCancellationsByScheduleId.add(scheduleId);
		agentManager.cancelBackup(LOCAL_AGENT_ID, {
			jobId,
			scheduleId: activeExecution.scheduleShortId,
		});

		return true;
	},
};
