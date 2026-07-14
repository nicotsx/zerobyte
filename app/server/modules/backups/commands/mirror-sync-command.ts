import { logger } from "@zerobyte/core/node";
import type { RetentionPolicy } from "@zerobyte/core/restic";
import type { Repository } from "~/server/db/schema";
import type { TaskResult } from "~/schemas/tasks";
import { repoMutex } from "../../../core/repository-mutex";
import { restic } from "../../../core/restic";
import { cache, cacheKeys } from "../../../utils/cache";
import { runEffectPromise } from "../../../utils/errors";
import { runTaskLifecycle, TaskCancelledError } from "../../tasks/tasks.lifecycle";
import { taskStore } from "../../tasks/tasks.store";
import { executeForget } from "../helpers/backup-maintenance";

type MirrorSyncExecutionPlan = {
	organizationId: string;
	scheduleId: number;
	scheduleShortId: string;
	sourceRepository: Repository;
	mirrorRepository: Repository;
	retentionPolicy: RetentionPolicy | null;
	customResticParams: string[];
	snapshotIds?: string[];
};

type MirrorSyncTaskResult = Extract<TaskResult, { kind: "mirrorSync" }>;

const getTaskResource = (plan: MirrorSyncExecutionPlan) => ({
	organizationId: plan.organizationId,
	kind: "mirrorSync" as const,
	resourceType: "backup_schedule" as const,
	resourceId: plan.scheduleShortId,
	operationKey: plan.mirrorRepository.shortId,
});

const executeMirrorSync = async (
	plan: MirrorSyncExecutionPlan,
	taskId: string,
	signal: AbortSignal,
): Promise<MirrorSyncTaskResult> => {
	logger.info(`Syncing snapshots to mirror repository: ${plan.mirrorRepository.name}`);

	try {
		const releaseLocks = await repoMutex.acquireMany(
			[
				{
					repositoryId: plan.sourceRepository.id,
					type: "shared",
					operation: `mirror_sync_source:${taskId}`,
				},
				{
					repositoryId: plan.mirrorRepository.id,
					type: "exclusive",
					operation: `mirror_sync:${taskId}`,
				},
			],
			signal,
		);

		try {
			await runEffectPromise(
				restic.copy(plan.sourceRepository.config, plan.mirrorRepository.config, {
					tag: plan.scheduleShortId,
					organizationId: plan.organizationId,
					snapshotIds: plan.snapshotIds,
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
			await executeForget({
				repository: plan.mirrorRepository,
				retentionPolicy: plan.retentionPolicy,
				tag: plan.scheduleShortId,
				organizationId: plan.organizationId,
				signal,
			});
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

export const hasActiveMirrorSync = (plan: MirrorSyncExecutionPlan) => {
	const taskResource = getTaskResource(plan);
	return taskStore.findActiveByResource(taskResource) !== null;
};

export const createMirrorSyncCommand = (plan: MirrorSyncExecutionPlan) => {
	return {
		start: () => {
			const taskResource = getTaskResource(plan);
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

			void runTaskLifecycle({
				taskId: task.id,
				label: "mirror sync task",
				cancellable: true,
				run: (signal) => executeMirrorSync(plan, task.id, signal),
			});

			return { taskId: task.id, status: "started" as const };
		},
	};
};
