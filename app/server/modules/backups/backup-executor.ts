import { Effect } from "effect";
import { runBackupLifecycle } from "@zerobyte/core/backup-hooks";
import type { BackupSchedule, Volume, Repository } from "../../db/schema";
import { config } from "../../core/config";
import { restic, resticDeps } from "../../core/restic";
import type { BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import { agentManager, type BackupExecutionProgress } from "../agents/agents-manager";
import { LOCAL_AGENT_ID } from "../agents/constants";
import { getVolumePath } from "../volumes/helpers";
import { decryptRepositoryConfig } from "../repositories/repository-config-secrets";
import { createBackupOptions } from "./backup.helpers";
import { toErrorDetails } from "../../utils/errors";

type BackupExecutionRequest = {
	scheduleId: number;
	schedule: BackupSchedule;
	volume: Volume;
	repository: Repository;
	organizationId: string;
	signal: AbortSignal;
	onProgress: (progress: BackupExecutionProgress) => void;
};

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
		webhooks: schedule.backupWebhooks ?? { pre: null, post: null },
	};
};

const executeBackupWithoutAgent = async (
	payload: BackupRunPayload,
	{ signal, onProgress }: Pick<BackupExecutionRequest, "signal" | "onProgress">,
) => {
	return Effect.runPromise(
		runBackupLifecycle({
			restic,
			repositoryConfig: payload.repositoryConfig,
			sourcePath: payload.sourcePath,
			jobId: payload.jobId,
			scheduleId: payload.scheduleId,
			organizationId: payload.organizationId,
			options: payload.options,
			webhooks: payload.webhooks,
			signal,
			onProgress,
			formatError: toErrorDetails,
		}),
	);
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

		if (request.signal.aborted) {
			throw request.signal.reason || new Error("Operation aborted");
		}

		const jobId = Bun.randomUUIDv7();

		const payload = await createBackupRunPayload({ ...request, jobId });

		if (request.signal.aborted) {
			throw request.signal.reason || new Error("Operation aborted");
		}

		const executionResult = await agentManager.runBackup(LOCAL_AGENT_ID, {
			scheduleId: request.scheduleId,
			payload,
			signal: request.signal,
			onProgress: request.onProgress,
		});

		if (executionResult.status === "unavailable" && !config.flags.enableLocalAgent) {
			return executeBackupWithoutAgent(payload, request);
		}

		return executionResult;
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
