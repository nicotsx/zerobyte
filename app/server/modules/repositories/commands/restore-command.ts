import type { RepositoryConfig } from "@zerobyte/core/restic";
import type { RestoreRunPayload } from "@zerobyte/contracts/agent-protocol";
import type { TaskResult } from "~/schemas/tasks";
import { repoMutex } from "../../../core/repository-mutex";
import { restic, resticDeps } from "../../../core/restic";
import { runEffectPromise } from "../../../utils/errors";
import { agentManager, type RestoreExecutionProgress } from "../../agents/agents-manager";
import { runTaskLifecycle, TaskCancelledError } from "../../tasks/tasks.lifecycle";
import { taskStore } from "../../tasks/tasks.store";

type RestoreExecutionOptions = Omit<Parameters<typeof restic.restore>[3], "organizationId" | "signal" | "onProgress">;

type RestoreExecutionTarget = { kind: "controller" } | { kind: "agent"; agentId: string };

type RestoreCommandParams = {
	organizationId: string;
	repositoryId: string;
	repositoryShortId: string;
	repositoryConfig: RepositoryConfig;
	snapshotId: string;
	target: string;
	executionTarget: RestoreExecutionTarget;
	options: RestoreExecutionOptions;
};

type RestoreExecutionRequest = RestoreCommandParams & {
	restoreId: string;
	signal: AbortSignal;
	onProgress: (progress: RestoreExecutionProgress) => void;
};

type RestoreTaskResult = Extract<TaskResult, { kind: "restore" }>;

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

const executeControllerRestore = async (request: RestoreExecutionRequest) => {
	return await runEffectPromise(
		restic.restore(request.repositoryConfig, request.snapshotId, request.target, {
			...request.options,
			organizationId: request.organizationId,
			signal: request.signal,
			onProgress: request.onProgress,
		}),
	);
};

const executeAgentRestore = async (request: RestoreExecutionRequest, agentId: string) => {
	const payload = await createRestoreRunPayload(request);
	const started = await agentManager.startRestore(agentId, {
		payload,
		signal: request.signal,
		onProgress: request.onProgress,
	});

	if (started.status === "unavailable") {
		throw started.error;
	}

	const result = await started.result;
	switch (result.status) {
		case "completed":
			return result.result;
		case "cancelled":
			throw new TaskCancelledError(result.message ?? "Restore was cancelled");
		case "failed":
			throw new Error(result.error);
		case "unavailable":
			throw result.error;
	}
};

const executeRestore = async (request: RestoreExecutionRequest) => {
	const releaseLock = await repoMutex.acquireShared(
		request.repositoryId,
		`restore:${request.restoreId}`,
		request.signal,
	);

	try {
		if (request.executionTarget.kind === "controller") {
			return await executeControllerRestore(request);
		}

		return await executeAgentRestore(request, request.executionTarget.agentId);
	} finally {
		releaseLock();
	}
};

const runRestoreTask = async (
	params: RestoreCommandParams,
	restoreId: string,
	signal: AbortSignal,
): Promise<RestoreTaskResult> => {
	const result = await executeRestore({
		...params,
		restoreId,
		signal,
		onProgress: (progress) => taskStore.updateProgress(restoreId, { kind: "restore", progress }),
	});

	return { kind: "restore", result };
};

export const createRestoreCommand = (params: RestoreCommandParams) => {
	return {
		start: () => {
			const task = taskStore.create({
				organizationId: params.organizationId,
				resourceType: "repository",
				resourceId: params.repositoryShortId,
				operationKey: params.snapshotId,
				targetAgentId: params.executionTarget.kind === "agent" ? params.executionTarget.agentId : null,
				input: {
					kind: "restore",
					repositoryId: params.repositoryShortId,
					snapshotId: params.snapshotId,
					target: params.target,
				},
			});

			void runTaskLifecycle({
				taskId: task.id,
				label: "restore task",
				cancellable: true,
				run: (signal) => runRestoreTask(params, task.id, signal),
			});

			return { restoreId: task.id, status: "started" as const };
		},
	};
};
