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
import { BadRequestError } from "http-errors-enhanced";

const FUSE_VOLUME_BACKENDS = new Set<Volume["type"]>(["rclone", "sftp", "webdav"]);
const IGNORE_INODE_FLAG = "--ignore-inode";
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

const activeControllersByScheduleId = new Map<number, { abortController: AbortController; agentId: string | null }>();

const getBackupExecutionAgentId = (volume: Volume, repository: Repository) => {
	if (repository.type === "local" && volume.agentId !== LOCAL_AGENT_ID) {
		throw new BadRequestError(`Local repository "${repository.name}" can only be used with the local agent`);
	}

	return volume.agentId;
};

const createBackupRunPayload = async ({
	jobId,
	schedule,
	volume,
	repository,
	organizationId,
}: BackupExecutionRequest & { jobId: string }): Promise<BackupRunPayload> => {
	const sourcePath = getVolumePath(volume);
	const { signal: _, ...options } = createBackupOptions(schedule, sourcePath);

	if (FUSE_VOLUME_BACKENDS.has(volume.type) && !options.customResticParams.includes(IGNORE_INODE_FLAG)) {
		options.customResticParams = [...options.customResticParams, IGNORE_INODE_FLAG];
	}

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
		webhookAllowedOrigins: config.webhookAllowedOrigins,
		webhookTimeoutMs: config.webhookTimeout * 1000,
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
			webhookAllowedOrigins: payload.webhookAllowedOrigins,
			webhookTimeoutMs: payload.webhookTimeoutMs,
			signal,
			onProgress,
			formatError: toErrorDetails,
		}),
	);
};

export const backupExecutor = {
	track: (scheduleId: number) => {
		const abortController = new AbortController();
		activeControllersByScheduleId.set(scheduleId, { abortController, agentId: null });
		return abortController;
	},
	untrack: (scheduleId: number, abortController: AbortController) => {
		if (activeControllersByScheduleId.get(scheduleId)?.abortController === abortController) {
			activeControllersByScheduleId.delete(scheduleId);
		}
	},
	execute: async (request: Omit<BackupExecutionRequest, "jobId">) => {
		const trackedExecution = activeControllersByScheduleId.get(request.scheduleId);
		if (!trackedExecution || trackedExecution.abortController.signal !== request.signal) {
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

		const executionAgentId = getBackupExecutionAgentId(request.volume, request.repository);
		trackedExecution.agentId = executionAgentId;

		const executionResult = await agentManager.runBackup(executionAgentId, {
			scheduleId: request.scheduleId,
			payload,
			signal: request.signal,
			onProgress: request.onProgress,
		});

		if (
			executionResult.status === "unavailable" &&
			executionAgentId === LOCAL_AGENT_ID &&
			!config.flags.enableLocalAgent
		) {
			return executeBackupWithoutAgent(payload, request);
		}

		return executionResult;
	},
	cancel: async (scheduleId: number) => {
		const trackedExecution = activeControllersByScheduleId.get(scheduleId);
		if (!trackedExecution) {
			return false;
		}

		trackedExecution.abortController.abort();
		if (!trackedExecution.agentId) {
			return true;
		}

		await agentManager.cancelBackup(trackedExecution.agentId, scheduleId);
		return true;
	},
};
