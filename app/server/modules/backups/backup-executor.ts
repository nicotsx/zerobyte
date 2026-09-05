import type { BackupSchedule, Volume, Repository } from "../../db/schema";
import { config } from "../../core/config";
import { resticDeps } from "../../core/restic";
import type { BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import { agentManager, type BackupExecutionProgress } from "../agents/agents-manager";
import { decryptRepositoryConfig } from "../repositories/repository-config-secrets";
import { assembleVolumeExecutionSource } from "../volumes/volume-execution-source";
import { assertBackupRepositoryCompatibility } from "./backup-context";

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
	assertBackupRepositoryCompatibility(volume, repository);
	return volume.agentId;
};

const createBackupRunPayload = async ({
	jobId,
	schedule,
	volume,
	repository,
	organizationId,
}: BackupExecutionRequest): Promise<BackupRunPayload> => {
	const customResticParams = schedule.customResticParams ?? [];
	const needsIgnoreInode = volume.type !== null && FUSE_VOLUME_BACKENDS.has(volume.type);
	const hasIgnoreInode = customResticParams.includes(IGNORE_INODE_FLAG);
	const executionResticParams =
		needsIgnoreInode && !hasIgnoreInode ? [...customResticParams, IGNORE_INODE_FLAG] : customResticParams;
	const source = await assembleVolumeExecutionSource(volume, organizationId);

	const repositoryConfig = await decryptRepositoryConfig(repository.config);
	const encryptedResticPassword = await resticDeps.getOrganizationResticPassword(organizationId);
	const resticPassword = await resticDeps.resolveSecret(encryptedResticPassword);

	return {
		jobId,
		scheduleId: schedule.shortId,
		organizationId,
		source,
		repositoryConfig,
		options: {
			oneFileSystem: schedule.oneFileSystem,
			excludePatterns: schedule.excludePatterns,
			excludeIfPresent: schedule.excludeIfPresent,
			includePaths: schedule.includePaths,
			includePatterns: schedule.includePatterns,
			customResticParams: executionResticParams,
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

export const backupExecutor = {
	execute: async (request: BackupExecutionRequest) => {
		if (request.signal.aborted) {
			throw request.signal.reason || new Error("Operation aborted");
		}

		const executionAgentId = getBackupExecutionAgentId(request.volume, request.repository);
		const payload = await createBackupRunPayload(request);

		if (request.signal.aborted) {
			throw request.signal.reason || new Error("Operation aborted");
		}

		const executionResult = await agentManager.runBackup(executionAgentId, {
			scheduleId: request.scheduleId,
			payload,
			signal: request.signal,
			onProgress: request.onProgress,
		});

		return executionResult;
	},
};
