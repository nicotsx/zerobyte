import { ConflictError } from "http-errors-enhanced";
import { logger } from "@zerobyte/core/node";
import type { RetentionPolicy } from "@zerobyte/core/restic";
import type { Repository } from "~/server/db/schema";
import type { TaskResult } from "~/schemas/tasks";
import { repoMutex } from "../../../core/repository-mutex";
import { restic } from "../../../core/restic";
import { cache, cacheKeys } from "../../../utils/cache";
import { runEffectPromise, toMessage } from "../../../utils/errors";
import { runTaskLifecycle, TaskCancelledError } from "../../tasks/tasks.lifecycle";
import { taskStore } from "../../tasks/tasks.store";
import { executeForget } from "../helpers/backup-maintenance";

type MirrorSyncPlan = {
	organizationId: string;
	scheduleId: number;
	scheduleShortId: string;
	sourceRepository: Repository;
	mirrorRepository: Repository;
	retentionPolicy: RetentionPolicy | null;
	customResticParams: string[];
	snapshotIds?: string[];
};

type ManualMirrorSyncPlan = MirrorSyncPlan & { trigger: "manual" };
type PostBackupMirrorSyncPlan = Omit<MirrorSyncPlan, "snapshotIds"> & {
	trigger: "postBackup";
	snapshotIds: [string, ...string[]];
};
type MirrorSyncExecutionPlan = ManualMirrorSyncPlan | PostBackupMirrorSyncPlan;

type MirrorSyncTaskResult = Extract<TaskResult, { kind: "mirrorSync" }>;

const getTaskResource = (plan: MirrorSyncExecutionPlan) => ({
	organizationId: plan.organizationId,
	kind: "mirrorSync" as const,
	resourceType: "backup_schedule" as const,
	resourceId: plan.scheduleShortId,
	operationKey: plan.mirrorRepository.shortId,
});

const getTaskSnapshotIds = (organizationId: string, taskId: string) => {
	const task = taskStore.findById({ organizationId, taskId });
	if (!task || task.input.kind !== "mirrorSync") {
		throw new Error(`Mirror sync task ${taskId} was not found`);
	}

	return task.input.snapshotIds;
};

const executeMirrorSync = async (
	plan: MirrorSyncExecutionPlan,
	taskId: string,
	signal: AbortSignal,
	releaseLocks: () => void,
): Promise<MirrorSyncTaskResult> => {
	logger.info(`Syncing snapshots to mirror repository: ${plan.mirrorRepository.name}`);

	try {
		try {
			const snapshotIds = getTaskSnapshotIds(plan.organizationId, taskId);
			await runEffectPromise(
				restic.copy(plan.sourceRepository.config, plan.mirrorRepository.config, {
					tag: plan.scheduleShortId,
					organizationId: plan.organizationId,
					snapshotIds,
					customResticParams: plan.customResticParams,
					signal,
				}),
			);
			cache.delByPrefix(cacheKeys.repository.all(plan.mirrorRepository.id));
		} finally {
			releaseLocks();
		}

		signal.throwIfAborted();

		if (plan.retentionPolicy) {
			try {
				await executeForget({
					repository: plan.mirrorRepository,
					retentionPolicy: plan.retentionPolicy,
					tag: plan.scheduleShortId,
					organizationId: plan.organizationId,
					signal,
				});
			} catch (error) {
				if (signal.aborted) {
					throw error;
				}

				const errorMessage = toMessage(error);
				logger.error(
					`Mirror retention maintenance failed for repository ${plan.mirrorRepository.name}: ${errorMessage}`,
				);
			}
		}

		signal.throwIfAborted();
		logger.info(`Successfully synced snapshots to mirror repository: ${plan.mirrorRepository.name}`);
		return { kind: "mirrorSync" };
	} catch (error) {
		if (signal.aborted) {
			logger.info(`Mirror sync cancelled for repository ${plan.mirrorRepository.name}`);
			throw new TaskCancelledError("Mirror sync was cancelled");
		}

		throw error;
	}
};

const mergeIntoQueuedTask = (plan: PostBackupMirrorSyncPlan) => {
	const taskResource = getTaskResource(plan);
	const queuedTask = taskStore.findQueuedByResource(taskResource);
	if (!queuedTask || queuedTask.input.kind !== "mirrorSync") {
		return null;
	}

	const existingSnapshotIds = queuedTask.input.snapshotIds ?? [];
	const incomingSnapshotIds = plan.snapshotIds;
	const snapshotIds = [...new Set([...existingSnapshotIds, ...incomingSnapshotIds])];
	const input = { ...queuedTask.input, snapshotIds };
	return taskStore.updateQueuedInput(queuedTask.id, input);
};

export function createMirrorSyncCommand(plan: ManualMirrorSyncPlan): {
	start: () => { taskId: string; status: "started" };
};
export function createMirrorSyncCommand(plan: PostBackupMirrorSyncPlan): {
	start: () => { taskId: string; status: "started" | "queued" };
};
export function createMirrorSyncCommand(plan: MirrorSyncExecutionPlan) {
	return {
		start: () => {
			const taskResource = getTaskResource(plan);
			if (plan.trigger === "manual" && taskStore.findActiveByResource(taskResource)) {
				throw new ConflictError("Mirror is already syncing");
			}

			if (plan.trigger === "postBackup") {
				const queuedTask = mergeIntoQueuedTask(plan);
				if (queuedTask) {
					return { taskId: queuedTask.id, status: "queued" as const };
				}
			}

			const task = taskStore.create({
				organizationId: plan.organizationId,
				resourceType: taskResource.resourceType,
				resourceId: taskResource.resourceId,
				operationKey: taskResource.operationKey,
				input: {
					kind: "mirrorSync",
					scheduleId: plan.scheduleId,
					scheduleShortId: plan.scheduleShortId,
					mirrorRepositoryId: plan.mirrorRepository.shortId,
					snapshotIds: plan.snapshotIds,
				},
			});
			let releaseLocks = () => {};

			void runTaskLifecycle({
				taskId: task.id,
				label: "mirror sync task",
				cancellable: true,
				prepare: async (signal) => {
					const release = await repoMutex.acquireMany(
						[
							{
								repositoryId: plan.sourceRepository.id,
								type: "shared",
								operation: `mirror_sync_source:${task.id}`,
							},
							{
								repositoryId: plan.mirrorRepository.id,
								type: "exclusive",
								operation: `mirror_sync:${task.id}`,
							},
						],
						signal,
					);
					releaseLocks = release;
					return releaseLocks;
				},
				run: (signal) => executeMirrorSync(plan, task.id, signal, releaseLocks),
			});

			return { taskId: task.id, status: "started" as const };
		},
	};
}
