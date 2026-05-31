import type { RepositoryConfig } from "@zerobyte/core/restic";
import type { RestoreRunPayload } from "@zerobyte/contracts/agent-protocol";
import { config as appConfig } from "~/server/core/config";
import { repoMutex } from "../../core/repository-mutex";
import { restic, resticDeps } from "../../core/restic";
import { runEffectPromise, toMessage } from "../../utils/errors";
import { agentManager, type RestoreExecutionProgress, type RestoreExecutionResult } from "../agents/agents-manager";
import { LOCAL_AGENT_ID } from "../agents/constants";

type RestoreExecutionOptions = Omit<Parameters<typeof restic.restore>[3], "organizationId" | "signal" | "onProgress">;

type RestoreExecutionRequest = {
	restoreId: string;
	organizationId: string;
	repositoryId: string;
	repositoryShortId: string;
	repositoryConfig: RepositoryConfig;
	snapshotId: string;
	target: string;
	executionAgentId: string;
	options: RestoreExecutionOptions;
	onStarted: () => void;
	onProgress: (progress: RestoreExecutionProgress) => void;
};

type RestoreExecutionHandle = {
	result: Promise<RestoreExecutionResult>;
};

const shouldRunInController = (agentId: string) => agentId === LOCAL_AGENT_ID && !appConfig.flags.enableLocalAgent;

const createRestoreRunPayload = async (request: RestoreExecutionRequest): Promise<RestoreRunPayload> => {
	const encryptedResticPassword = await resticDeps.getOrganizationResticPassword(request.organizationId);
	const resticPassword = await resticDeps.resolveSecret(encryptedResticPassword);

	return {
		restoreId: request.restoreId,
		organizationId: request.organizationId,
		repositoryId: request.repositoryShortId,
		snapshotId: request.snapshotId,
		target: request.target,
		repositoryConfig: request.repositoryConfig,
		runtime: { password: resticPassword },
		options: {
			...request.options,
			organizationId: request.organizationId,
		},
	};
};

const executeControllerRestore = async (
	request: RestoreExecutionRequest,
	signal: AbortSignal,
): Promise<RestoreExecutionResult> => {
	if (signal.aborted) {
		return { status: "cancelled", message: "Restore was cancelled" };
	}

	request.onStarted();

	try {
		const result = await runEffectPromise(
			restic.restore(request.repositoryConfig, request.snapshotId, request.target, {
				...request.options,
				organizationId: request.organizationId,
				signal,
				onProgress: request.onProgress,
			}),
		);

		return { status: "completed", result };
	} catch (error) {
		if (signal.aborted) {
			return { status: "cancelled", message: "Restore was cancelled" };
		}

		return { status: "failed", error: toMessage(error) };
	}
};

export const restoreExecutor = {
	start: async (request: RestoreExecutionRequest): Promise<RestoreExecutionHandle> => {
		const abortController = new AbortController();

		let releaseLock: (() => void) | null = null;
		try {
			releaseLock = await repoMutex.acquireShared(
				request.repositoryId,
				`restore:${request.restoreId}`,
				abortController.signal,
			);

			let result: Promise<RestoreExecutionResult>;
			if (shouldRunInController(request.executionAgentId)) {
				result = executeControllerRestore(request, abortController.signal);
			} else {
				const payload = await createRestoreRunPayload(request);
				const started = await agentManager.startRestore(request.executionAgentId, {
					payload,
					signal: abortController.signal,
					onStarted: request.onStarted,
					onProgress: request.onProgress,
				});

				if (started.status === "unavailable") {
					throw started.error;
				}

				result = started.result;
			}

			return {
				result: result.finally(() => {
					releaseLock?.();
				}),
			};
		} catch (error) {
			releaseLock?.();
			throw error;
		}
	},
};
