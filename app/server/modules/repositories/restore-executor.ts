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

const isAbortLikeError = (error: unknown) => {
	const message = toMessage(error);
	return message === "Repository mutex is shutting down" || message === "Operation aborted";
};

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
		if (signal.aborted || isAbortLikeError(error)) {
			return { status: "cancelled", message: "Restore was cancelled" };
		}

		return { status: "failed", error: toMessage(error) };
	}
};

const executeAgentRestore = async (
	request: RestoreExecutionRequest,
	signal: AbortSignal,
): Promise<RestoreExecutionResult> => {
	if (signal.aborted) {
		return { status: "cancelled", message: "Restore was cancelled" };
	}

	try {
		const payload = await createRestoreRunPayload(request);
		const started = await agentManager.startRestore(request.executionAgentId, {
			payload,
			signal,
			onStarted: request.onStarted,
			onProgress: request.onProgress,
		});

		if (started.status === "unavailable") {
			return started;
		}

		return await started.result;
	} catch (error) {
		if (signal.aborted || isAbortLikeError(error)) {
			return { status: "cancelled", message: "Restore was cancelled" };
		}

		return { status: "failed", error: toMessage(error) };
	}
};

const executeRestoreWithRepositoryLock = async (
	request: RestoreExecutionRequest,
	signal: AbortSignal,
): Promise<RestoreExecutionResult> => {
	try {
		return await repoMutex.runShared(
			request.repositoryId,
			`restore:${request.restoreId}`,
			async ({ signal: operationSignal }) => {
				if (shouldRunInController(request.executionAgentId)) {
					return await executeControllerRestore(request, operationSignal);
				}

				return await executeAgentRestore(request, operationSignal);
			},
			signal,
		);
	} catch (error) {
		if (signal.aborted || isAbortLikeError(error)) {
			return { status: "cancelled", message: "Restore was cancelled" };
		}

		return { status: "failed", error: toMessage(error) };
	}
};

export const restoreExecutor = {
	start: (request: RestoreExecutionRequest): RestoreExecutionHandle => {
		const abortController = new AbortController();

		return {
			result: executeRestoreWithRepositoryLock(request, abortController.signal),
		};
	},
};
