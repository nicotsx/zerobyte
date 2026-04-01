import { logger } from "@zerobyte/core/node";
import type { BackupProgressPayload, BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import type { ResticBackupOutputDto } from "@zerobyte/core/restic";
import { resticDeps } from "../../core/restic";
import type { BackupSchedule, Repository, Volume } from "../../db/schema";
import { agentManager } from "../agents/agents-manager";
import { decryptRepositoryConfig } from "../repositories/repository-config-secrets";
import { getVolumePath } from "../volumes/helpers";
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

const trackedAbortControllersByScheduleId = new Map<number, AbortController>();
const activeExecutionsByJobId = new Map<string, ActiveBackupExecution>();
const activeExecutionJobIdsByScheduleId = new Map<number, string>();
const requestedCancellationsByScheduleId = new Set<number>();

const getCancellationError = (signal: AbortSignal, message?: string) =>
	signal.reason instanceof Error ? signal.reason : new Error(message ?? "Backup was stopped by the user");

const createBackupRunPayload = async ({
	jobId,
	schedule,
	volume,
	repository,
	organizationId,
}: BackupExecutionRequest): Promise<BackupRunPayload> => {
	const sourcePath = getVolumePath(volume);
	const { signal: _ignoredSignal, ...options } = createBackupOptions(schedule, sourcePath);
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

const getActiveExecution = (jobId: string, scheduleId: string, eventName: string, executorId: string) => {
	const activeExecution = activeExecutionsByJobId.get(jobId);
	if (!activeExecution) {
		logger.warn(`Received ${eventName} for unknown job ${jobId} from executor ${executorId}`);
		return null;
	}

	if (activeExecution.scheduleShortId !== scheduleId) {
		logger.warn(
			`Ignoring ${eventName} for job ${jobId} due to schedule mismatch ${scheduleId} from executor ${executorId}`,
		);
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

		requestedCancellationsByScheduleId.delete(activeExecution.scheduleId);
		clearActiveExecution(payload.jobId);
		activeExecution.resolve({
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

		requestedCancellationsByScheduleId.delete(activeExecution.scheduleId);
		clearActiveExecution(payload.jobId);
		activeExecution.resolve({
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
		requestedCancellationsByScheduleId.delete(activeExecution.scheduleId);
		clearActiveExecution(payload.jobId);
		activeExecution.resolve({
			status: "cancelled",
			message: wasRequested ? undefined : payload.message,
		});
	},
});

export const backupExecutor = {
	track: (scheduleId: number) => {
		const abortController = new AbortController();
		trackedAbortControllersByScheduleId.set(scheduleId, abortController);
		return abortController;
	},
	untrack: (scheduleId: number, abortController: AbortController) => {
		if (trackedAbortControllersByScheduleId.get(scheduleId) === abortController) {
			trackedAbortControllersByScheduleId.delete(scheduleId);
		}
		requestedCancellationsByScheduleId.delete(scheduleId);
	},
	execute: async (request: Omit<BackupExecutionRequest, "jobId">) => {
		if (request.signal.aborted) {
			throw getCancellationError(request.signal);
		}

		const jobId = Bun.randomUUIDv7();
		const payload = await createBackupRunPayload({ ...request, jobId });

		if (request.signal.aborted) {
			throw getCancellationError(request.signal);
		}

		const completion = new Promise<BackupExecutionResult>((resolve) => {
			activeExecutionsByJobId.set(jobId, {
				scheduleId: request.scheduleId,
				scheduleShortId: request.schedule.shortId,
				onProgress: request.onProgress,
				resolve,
			});
			activeExecutionJobIdsByScheduleId.set(request.scheduleId, jobId);
		});

		let dispatched = false;
		const handleAbort = () => {
			const activeExecution = activeExecutionsByJobId.get(jobId);
			if (!activeExecution) {
				return;
			}

			if (!dispatched) {
				clearActiveExecution(jobId);
				activeExecution.resolve({ status: "cancelled" });
				return;
			}

			requestedCancellationsByScheduleId.add(request.scheduleId);
			if (
				!agentManager.cancelBackup(LOCAL_AGENT_ID, {
					jobId,
					scheduleId: activeExecution.scheduleShortId,
				})
			) {
				requestedCancellationsByScheduleId.delete(request.scheduleId);
				clearActiveExecution(jobId);
				activeExecution.resolve({ status: "cancelled" });
			}
		};

		request.signal.addEventListener("abort", handleAbort, { once: true });

		if (request.signal.aborted) {
			return completion;
		}

		dispatched = agentManager.sendBackup(LOCAL_AGENT_ID, payload);
		if (!dispatched) {
			request.signal.removeEventListener("abort", handleAbort);
			requestedCancellationsByScheduleId.delete(request.scheduleId);
			clearActiveExecution(jobId);
			return {
				status: "unavailable",
				error: new Error("Local backup agent is not connected"),
			} satisfies BackupExecutionResult;
		}

		try {
			return await completion;
		} finally {
			request.signal.removeEventListener("abort", handleAbort);
		}
	},
	cancel: (scheduleId: number) => {
		const abortController = trackedAbortControllersByScheduleId.get(scheduleId);
		if (!abortController) {
			return false;
		}

		abortController.abort(new Error("Backup was stopped by the user"));
		return true;
	},
};
