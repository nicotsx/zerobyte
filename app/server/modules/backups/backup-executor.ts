import type { BackupSchedule, Volume, Repository } from "../../db/schema";
import { config } from "../../core/config";
import { resticDeps } from "../../core/restic";
import type { BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import { agentManager, type BackupExecutionProgress } from "../agents/agents-manager";
import { decryptRepositoryConfig } from "../repositories/repository-config-secrets";
import { volumeService } from "../volumes/volume.service";
import { assembleVolumeExecutionSource } from "../volumes/volume-execution-source";

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

const createBackupRunPayload = async ({
	jobId,
	schedule,
	volume,
	repository,
	organizationId,
	signal,
}: BackupExecutionRequest): Promise<BackupRunPayload> => {
	const customResticParams = schedule.customResticParams ?? [];
	const needsIgnoreInode = volume.type !== null && FUSE_VOLUME_BACKENDS.has(volume.type);
	const hasIgnoreInode = customResticParams.includes(IGNORE_INODE_FLAG);
	const executionResticParams =
		needsIgnoreInode && !hasIgnoreInode ? [...customResticParams, IGNORE_INODE_FLAG] : customResticParams;

	if (volume.sourceKind === "managed") {
		const readiness = await volumeService.ensureHealthyVolume(volume, signal);
		if (!readiness.ready) throw new Error(readiness.reason);
	}

	signal.throwIfAborted();
	const source = assembleVolumeExecutionSource(volume);

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
		webhookAllowedOrigins: config.runtime === "desktop" ? null : config.webhookAllowedOrigins,
		webhookTimeoutMs: config.webhookTimeout * 1000,
	};
};

export const backupExecutor = {
	execute: async (request: BackupExecutionRequest) => {
		request.signal.throwIfAborted();
		const payload = await createBackupRunPayload(request);

		request.signal.throwIfAborted();

		return agentManager.runBackup(request.volume.agentId, {
			scheduleId: request.scheduleId,
			payload,
			signal: request.signal,
			onProgress: request.onProgress,
		});
	},
};
