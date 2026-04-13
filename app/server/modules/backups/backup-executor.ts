import { Effect } from "effect";
import type { BackupSchedule, Volume, Repository } from "../../db/schema";
import { config } from "../../core/config";
import { restic, resticDeps } from "../../core/restic";
import type { BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import { agentManager, type BackupExecutionProgress } from "../agents/agents-manager";
import { getVolumePath } from "../volumes/helpers";
import { decryptRepositoryConfig } from "../repositories/repository-config-secrets";
import { createBackupOptions } from "./backup.helpers";
import { toErrorDetails } from "../../utils/errors";

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

const executeBackupWithoutAgent = async (
	payload: BackupRunPayload,
	{ signal, onProgress }: Pick<BackupExecutionRequest, "signal" | "onProgress">,
) => {
	try {
		const execution = await Effect.runPromise(
			restic
				.backup(payload.repositoryConfig, payload.sourcePath, {
					...payload.options,
					organizationId: payload.organizationId,
					signal,
					onProgress,
				})
				.pipe(
					Effect.map((result) => ({ success: true as const, result })),
					Effect.catchAll((error) => Effect.succeed({ success: false as const, error })),
				),
		);

		if (!execution.success) {
			return {
				status: "failed" as const,
				error: toErrorDetails(execution.error),
			};
		}

		const { exitCode, result, warningDetails } = execution.result;
		return {
			status: "completed" as const,
			exitCode,
			result,
			warningDetails,
		};
	} catch (error) {
		return {
			status: "failed" as const,
			error: toErrorDetails(error),
		};
	}
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
