import type { BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import { agentManager } from "../agents/agents-manager";
import { resticDeps } from "../../core/restic";
import type { BackupSchedule, Repository, Volume } from "../../db/schema";
import type { ResticBackupOutputDto, ResticBackupProgressDto } from "@zerobyte/core/restic";
import { createBackupOptions } from "./backup.helpers";
import { getVolumePath } from "../volumes/helpers";
import { decryptRepositoryConfig } from "../repositories/repository-config-secrets";

type BackupExecutionRequest = {
	scheduleId: number;
	schedule: BackupSchedule;
	volume: Volume;
	repository: Repository;
	organizationId: string;
	signal: AbortSignal;
	onProgress: (progress: BackupExecutionProgress) => void;
};

export type BackupExecutionProgress = ResticBackupProgressDto;

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
			error: unknown;
	  }
	| {
			status: "cancelled";
			message?: string;
	  };

type ActiveBackupExecution = {
	abortController: AbortController;
	jobId?: string;
	scheduleShortId?: string;
	onProgress?: (progress: BackupExecutionProgress) => void;
	resolve?: (result: BackupExecutionResult) => void;
	reject?: (error: unknown) => void;
	settled: boolean;
};

const LOCAL_AGENT_ID = "local";

const activeBackupsByScheduleId = new Map<number, ActiveBackupExecution>();
const activeScheduleIdsByJobId = new Map<string, number>();

const resetPendingExecution = (activeBackup: ActiveBackupExecution) => {
	activeBackup.jobId = undefined;
	activeBackup.scheduleShortId = undefined;
	activeBackup.onProgress = undefined;
	activeBackup.resolve = undefined;
	activeBackup.reject = undefined;
	activeBackup.settled = false;
};

const getActiveBackupByJobId = (jobId: string) => {
	const scheduleId = activeScheduleIdsByJobId.get(jobId);
	if (scheduleId === undefined) {
		return null;
	}

	const activeBackup = activeBackupsByScheduleId.get(scheduleId);
	if (!activeBackup || activeBackup.jobId !== jobId) {
		activeScheduleIdsByJobId.delete(jobId);
		return null;
	}

	return { scheduleId, activeBackup };
};

const resolveActiveBackup = (activeBackup: ActiveBackupExecution, result: BackupExecutionResult) => {
	if (activeBackup.settled) {
		return;
	}

	activeBackup.settled = true;
	activeBackup.resolve?.(result);
};

const rejectActiveBackup = (activeBackup: ActiveBackupExecution, error: unknown) => {
	if (activeBackup.settled) {
		return;
	}

	activeBackup.settled = true;
	activeBackup.reject?.(error);
};

const getCancellationError = (signal: AbortSignal, message?: string) =>
	signal.reason instanceof Error ? signal.reason : new Error(message ?? "Backup was stopped by the user");

const buildAgentBackupPayload = async (params: BackupExecutionRequest, jobId: string): Promise<BackupRunPayload> => {
	const { schedule, volume, repository, organizationId } = params;
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
			tags: options.tags,
			oneFileSystem: options.oneFileSystem,
			exclude: options.exclude,
			excludeIfPresent: options.excludeIfPresent,
			includePaths: options.includePaths,
			includePatterns: options.includePatterns,
			customResticParams: options.customResticParams,
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

agentManager.setBackupEventHandlers({
	onBackupProgress: ({ payload }) => {
		const running = getActiveBackupByJobId(payload.jobId);
		if (!running || running.activeBackup.scheduleShortId !== payload.scheduleId) {
			return;
		}

		running.activeBackup.onProgress?.(payload.progress);
	},
	onBackupCompleted: ({ payload }) => {
		const running = getActiveBackupByJobId(payload.jobId);
		if (!running || running.activeBackup.scheduleShortId !== payload.scheduleId) {
			return;
		}

		activeScheduleIdsByJobId.delete(payload.jobId);
		resolveActiveBackup(running.activeBackup, {
			status: "completed",
			exitCode: payload.exitCode,
			result: payload.result,
			warningDetails: payload.warningDetails ?? null,
		});
	},
	onBackupFailed: ({ payload }) => {
		const running = getActiveBackupByJobId(payload.jobId);
		if (!running || running.activeBackup.scheduleShortId !== payload.scheduleId) {
			return;
		}

		activeScheduleIdsByJobId.delete(payload.jobId);
		resolveActiveBackup(running.activeBackup, {
			status: "failed",
			error: payload.errorDetails ?? payload.error,
		});
	},
	onBackupCancelled: ({ payload }) => {
		const running = getActiveBackupByJobId(payload.jobId);
		if (!running || running.activeBackup.scheduleShortId !== payload.scheduleId) {
			return;
		}

		activeScheduleIdsByJobId.delete(payload.jobId);

		if (running.activeBackup.abortController.signal.aborted) {
			rejectActiveBackup(
				running.activeBackup,
				getCancellationError(running.activeBackup.abortController.signal, payload.message),
			);
			return;
		}

		resolveActiveBackup(running.activeBackup, {
			status: "cancelled",
			message: payload.message,
		});
	},
});

export const backupExecutor = {
	track: (scheduleId: number) => {
		const abortController = new AbortController();
		activeBackupsByScheduleId.set(scheduleId, {
			abortController,
			settled: false,
		});
		return abortController;
	},
	untrack: (scheduleId: number, abortController: AbortController) => {
		const activeBackup = activeBackupsByScheduleId.get(scheduleId);
		if (activeBackup?.abortController === abortController) {
			if (activeBackup.jobId) {
				activeScheduleIdsByJobId.delete(activeBackup.jobId);
			}
			activeBackupsByScheduleId.delete(scheduleId);
		}
	},
	execute: async (params: BackupExecutionRequest): Promise<BackupExecutionResult> => {
		const activeBackup = activeBackupsByScheduleId.get(params.scheduleId);
		if (!activeBackup) {
			throw new Error(`Backup ${params.scheduleId} is not tracked`);
		}

		if (params.signal.aborted) {
			throw getCancellationError(params.signal);
		}

		const jobId = Bun.randomUUIDv7();
		const payload = await buildAgentBackupPayload(params, jobId);

		if (params.signal.aborted) {
			throw getCancellationError(params.signal);
		}

		activeBackup.jobId = jobId;
		activeBackup.scheduleShortId = params.schedule.shortId;
		activeBackup.onProgress = params.onProgress;
		activeBackup.settled = false;

		const completion = new Promise<BackupExecutionResult>((resolve, reject) => {
			activeBackup.resolve = resolve;
			activeBackup.reject = reject;
		});

		const handleAbort = () => {
			activeScheduleIdsByJobId.delete(jobId);
			agentManager.cancelBackup(LOCAL_AGENT_ID, {
				jobId,
				scheduleId: params.schedule.shortId,
			});
			rejectActiveBackup(activeBackup, getCancellationError(params.signal));
		};

		params.signal.addEventListener("abort", handleAbort, { once: true });
		activeScheduleIdsByJobId.set(jobId, params.scheduleId);

		const dispatched = agentManager.sendBackup(LOCAL_AGENT_ID, payload);
		if (!dispatched) {
			params.signal.removeEventListener("abort", handleAbort);
			activeScheduleIdsByJobId.delete(jobId);
			resetPendingExecution(activeBackup);
			return {
				status: "unavailable",
				error: new Error("Local backup agent is not connected"),
			} satisfies BackupExecutionResult;
		}

		try {
			return await completion;
		} finally {
			params.signal.removeEventListener("abort", handleAbort);
		}
	},
	cancel: (scheduleId: number) => {
		const activeBackup = activeBackupsByScheduleId.get(scheduleId);
		if (!activeBackup) {
			return false;
		}

		activeBackup.abortController.abort(new Error("Backup was stopped by the user"));
		return true;
	},
};
