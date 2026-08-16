import { ConflictError } from "http-errors-enhanced";
import { logger } from "@zerobyte/core/node";
import type { RetentionPolicy } from "@zerobyte/core/restic";
import type { TaskResult } from "~/schemas/tasks";
import { repoMutex } from "~/server/core/repository-mutex";
import type { Repository } from "~/server/db/schema";
import { refreshStoredRepositoryStats } from "~/server/modules/repositories/helpers/repository-stats";
import { requestTaskCancel, runTaskLifecycle, TaskCancelledError } from "../../tasks/tasks.lifecycle";
import { taskStore } from "../../tasks/tasks.store";
import { toMessage } from "../../../utils/errors";
import { applyRetentionPolicy } from "../helpers/backup-maintenance";

type ForgetTaskResult = Extract<TaskResult, { kind: "forget" }>;

type ForgetCommandParams = {
	organizationId: string;
	scheduleId: number;
	scheduleShortId: string;
	targetDisplayName: string;
	repository: Repository;
	retentionPolicy: RetentionPolicy | null;
	trigger: "manual" | "postBackup";
};

type ManualForgetCommandParams = ForgetCommandParams & {
	retentionPolicy: RetentionPolicy;
	trigger: "manual";
};

type PostBackupForgetCommandParams = ForgetCommandParams & {
	trigger: "postBackup";
};

type CancelledPostBackupForgetTask = {
	status: "cancelled";
};

const getTaskResource = (params: ForgetCommandParams) => ({
	organizationId: params.organizationId,
	kind: "forget" as const,
	resourceType: "backup_schedule" as const,
	resourceId: params.scheduleShortId,
	operationKey: params.repository.shortId,
});

const getTaskRetentionPolicy = (organizationId: string, taskId: string) => {
	const task = taskStore.findById({ organizationId, taskId });
	if (!task || task.input.kind !== "forget") {
		throw new Error(`Retention task ${taskId} was not found`);
	}

	return task.input.retentionPolicy;
};

const executeRetention = async (
	params: ManualForgetCommandParams | PostBackupForgetCommandParams,
	taskId: string,
	signal: AbortSignal,
): Promise<ForgetTaskResult> => {
	try {
		const retentionPolicy = getTaskRetentionPolicy(params.organizationId, taskId);
		await applyRetentionPolicy({
			repository: params.repository,
			retentionPolicy,
			tag: params.scheduleShortId,
			organizationId: params.organizationId,
			signal,
		});
		signal.throwIfAborted();
	} catch (error) {
		if (signal.aborted) {
			throw new TaskCancelledError("Retention policy application was cancelled");
		}

		throw error;
	}

	return { kind: "forget" };
};

const refreshRepositoryStats = (params: ManualForgetCommandParams | PostBackupForgetCommandParams) => {
	void refreshStoredRepositoryStats(params.repository).catch((error) => {
		const errorMessage = toMessage(error);
		logger.error(
			`Failed to refresh repository stats after retention task for ${params.repository.shortId}: ${errorMessage}`,
		);
	});
};

const findQueuedForgetTask = (taskResource: ReturnType<typeof getTaskResource>) => {
	const queuedTask = taskStore.findQueuedByResource(taskResource);
	if (!queuedTask || queuedTask.input.kind !== "forget") {
		return null;
	}

	return queuedTask;
};

const mergeIntoQueuedTask = (
	queuedTask: NonNullable<ReturnType<typeof findQueuedForgetTask>>,
	retentionPolicy: RetentionPolicy,
) => {
	const input = {
		...queuedTask.input,
		retentionPolicy,
	};
	return taskStore.updateQueuedInput(queuedTask.id, input);
};

export function createForgetCommand(params: ManualForgetCommandParams): {
	start: () => { taskId: string; status: "started" };
};
export function createForgetCommand(params: PostBackupForgetCommandParams): {
	start: () => { taskId: string; status: "started" | "queued" } | CancelledPostBackupForgetTask | null;
};
export function createForgetCommand(params: ManualForgetCommandParams | PostBackupForgetCommandParams) {
	return {
		start: () => {
			const taskResource = getTaskResource(params);

			if (params.trigger === "manual" && taskStore.findActiveByResource(taskResource)) {
				throw new ConflictError("Retention policy is already being applied");
			}

			if (params.trigger === "postBackup") {
				const queuedTask = findQueuedForgetTask(taskResource);
				if (!params.retentionPolicy) {
					if (queuedTask) {
						const cancellationRequested = requestTaskCancel(queuedTask.id);
						if (cancellationRequested) {
							return { status: "cancelled" as const };
						}
					}

					return null;
				}

				if (queuedTask) {
					const updatedTask = mergeIntoQueuedTask(queuedTask, params.retentionPolicy);
					if (updatedTask) {
						return { taskId: updatedTask.id, status: "queued" as const };
					}
				}
			}

			if (!params.retentionPolicy) {
				throw new Error("Manual retention tasks require a retention policy");
			}

			const refreshStats = () => refreshRepositoryStats(params);
			const task = taskStore.create({
				organizationId: params.organizationId,
				resourceType: taskResource.resourceType,
				resourceId: taskResource.resourceId,
				targetDisplayName: params.targetDisplayName,
				operationKey: taskResource.operationKey,
				input: {
					kind: "forget",
					scheduleId: params.scheduleId,
					scheduleShortId: params.scheduleShortId,
					repositoryId: params.repository.shortId,
					retentionPolicy: params.retentionPolicy,
					trigger: params.trigger,
				},
			});

			void runTaskLifecycle({
				taskId: task.id,
				label: "retention task",
				cancellable: true,
				prepare: (signal) =>
					repoMutex.acquireExclusive(params.repository.id, `forget:${params.scheduleShortId}`, signal),
				run: (signal) => executeRetention(params, task.id, signal),
				onSucceeded: refreshStats,
				beforeFail: refreshStats,
				beforeCancel: refreshStats,
			});

			return { taskId: task.id, status: "started" as const };
		},
	};
}
