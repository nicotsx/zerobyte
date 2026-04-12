import type { BackupSchedule, Volume, Repository } from "../../db/schema";
import { resticDeps } from "../../core/restic";
import type { BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import { agentManager, type BackupExecutionProgress } from "../agents/agents-manager";
import { getVolumePath } from "../volumes/helpers";
import { decryptRepositoryConfig } from "../repositories/repository-config-secrets";
import { createBackupOptions } from "./backup.helpers";

const LOCAL_AGENT_ID = "local";

type BackupExecutionRequest = {
	scheduleId: number;
	schedule: BackupSchedule;
	volume: Volume;
	repository: Repository;
	organizationId: string;
	signal: AbortSignal;
	onProgress: (progress: BackupExecutionProgress) => void;
};

export type { BackupExecutionResult } from "../agents/agents-manager";

const activeControllersByScheduleId = new Map<number, AbortController>();

const createBackupRunPayload = async ({
	jobId,
	schedule,
	volume,
	repository,
	organizationId,
}: BackupExecutionRequest & { jobId: string }): Promise<BackupRunPayload> => {
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
		const trackedAbortController = activeControllersByScheduleId.get(request.scheduleId);
		if (!trackedAbortController || trackedAbortController.signal !== request.signal) {
			throw new Error(`Backup execution for schedule ${request.scheduleId} was not tracked`);
		}

		const jobId = Bun.randomUUIDv7();
		if (request.signal.aborted) {
			throw request.signal.reason || new Error("Operation aborted");
		}

		const payload = await createBackupRunPayload({ ...request, jobId });

		if (request.signal.aborted) {
			throw request.signal.reason || new Error("Operation aborted");
		}

		return agentManager.runBackup(LOCAL_AGENT_ID, {
			scheduleId: request.scheduleId,
			payload,
			signal: request.signal,
			onProgress: request.onProgress,
		});
	},
	cancel: async (scheduleId: number) => {
		const abortController = activeControllersByScheduleId.get(scheduleId);
		if (!abortController) {
			return false;
		}

		abortController.abort();
		await agentManager.cancelBackup(LOCAL_AGENT_ID, scheduleId);
		return true;
	},
};
