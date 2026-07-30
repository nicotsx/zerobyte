import { runBackupLifecycle } from "@zerobyte/core/backup-hooks";
import type { BackupSchedule, Volume, Repository } from "../../db/schema";
import { config } from "../../core/config";
import { restic, resticDeps } from "../../core/restic";
import type { BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import { agentManager, type BackupExecutionProgress } from "../agents/agents-manager";
import { LOCAL_AGENT_ID } from "../agents/constants";
import { getVolumePath } from "../volumes/helpers";
import { decryptVolumeConfig } from "../volumes/volume-config-secrets";
import { decryptRepositoryConfig } from "../repositories/repository-config-secrets";
import { createBackupOptions } from "./backup.helpers";
import { runEffectPromise, toErrorDetails } from "../../utils/errors";
import { BadRequestError } from "http-errors-enhanced";

const FUSE_VOLUME_BACKENDS = new Set<Volume["type"]>(["rclone", "sftp", "webdav"]);
const IGNORE_INODE_FLAG = "--ignore-inode";
type BackupExecutionRequest = {
	jobId: string;
	scheduleId: number;
	schedule: BackupSchedule;
	volume: Volume;
	repository: Repository;
	organizationId: string;
	signal: AbortSignal;
	onProgress: (progress: BackupExecutionProgress) => void;
};

export type { BackupExecutionResult } from "../agents/agents-manager";

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
}: BackupExecutionRequest): Promise<BackupRunPayload> => {
	const agentVolume = { ...volume, config: await decryptVolumeConfig(volume.config) };
	const customResticParams = schedule.customResticParams ?? [];

	const repositoryConfig = await decryptRepositoryConfig(repository.config);
	const encryptedResticPassword = await resticDeps.getOrganizationResticPassword(organizationId);
	const resticPassword = await resticDeps.resolveSecret(encryptedResticPassword);

	return {
		jobId,
		scheduleId: schedule.shortId,
		organizationId,
		volume: agentVolume,
		repositoryConfig,
		options: {
			oneFileSystem: schedule.oneFileSystem,
			excludePatterns: schedule.excludePatterns,
			excludeIfPresent: schedule.excludeIfPresent,
			includePaths: schedule.includePaths,
			includePatterns: schedule.includePatterns,
			customResticParams:
				FUSE_VOLUME_BACKENDS.has(volume.type) && !customResticParams.includes(IGNORE_INODE_FLAG)
					? [...customResticParams, IGNORE_INODE_FLAG]
					: customResticParams,
			compressionMode: schedule.compressionMode ?? repository.compressionMode ?? "auto",
		},
		runtime: {
			password: resticPassword,
		},
		webhooks: schedule.backupWebhooks ?? { pre: null, post: null },
		webhookAllowedOrigins: config.webhookAllowedOrigins,
		webhookTimeoutMs: config.webhookTimeout * 1000,
	};
};

const executeBackupWithoutAgent = async (
	payload: BackupRunPayload,
	{ schedule, volume, signal, onProgress }: BackupExecutionRequest,
) => {
	const sourcePath = getVolumePath(volume);
	const { signal: _, ...backupOptions } = createBackupOptions(schedule, sourcePath, signal);
	const options = {
		...backupOptions,
		customResticParams: payload.options.customResticParams ?? [],
		compressionMode: payload.options.compressionMode,
	};

	return runEffectPromise(
		runBackupLifecycle({
			restic,
			repositoryConfig: payload.repositoryConfig,
			sourcePath,
			jobId: payload.jobId,
			scheduleId: payload.scheduleId,
			organizationId: payload.organizationId,
			options,
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
	execute: async (request: BackupExecutionRequest) => {
		if (request.signal.aborted) {
			throw request.signal.reason || new Error("Operation aborted");
		}

		const payload = await createBackupRunPayload(request);

		if (request.signal.aborted) {
			throw request.signal.reason || new Error("Operation aborted");
		}

		const executionAgentId = getBackupExecutionAgentId(request.volume, request.repository);

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
};
