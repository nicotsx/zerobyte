import { logger } from "@zerobyte/core/node";
import { serverEvents } from "~/server/core/events";
import { repoMutex } from "../../../core/repository-mutex";
import { restic } from "../../../core/restic";
import type { Repository } from "../../../db/schema";
import { cache, cacheKeys } from "../../../utils/cache";
import { runEffectPromise, toMessage } from "../../../utils/errors";
import { runTaskLifecycle } from "../../tasks/tasks.lifecycle";
import { taskStore } from "../../tasks/tasks.store";
import type { TaskResult } from "~/schemas/tasks";
import { refreshStoredRepositoryStats } from "../helpers/repository-stats";

type DeleteSnapshotsTaskResult = Extract<TaskResult, { kind: "deleteSnapshots" }>;

type DeleteSnapshotsCommandParams = {
	repository: Repository;
	snapshotIds: string[];
};

type DeleteSnapshotsTaskContext = DeleteSnapshotsCommandParams & {
	taskId: string;
};

const emitDeleteSnapshotsStarted = (context: DeleteSnapshotsTaskContext) => {
	serverEvents.emit("snapshots:delete_started", {
		taskId: context.taskId,
		organizationId: context.repository.organizationId,
		repositoryId: context.repository.shortId,
		snapshotIds: context.snapshotIds,
	});
};

const emitDeleteSnapshotsCompleted = (
	context: DeleteSnapshotsTaskContext,
	payload: {
		status: "success" | "error";
		error?: string;
	},
) => {
	serverEvents.emit("snapshots:delete_completed", {
		taskId: context.taskId,
		organizationId: context.repository.organizationId,
		repositoryId: context.repository.shortId,
		snapshotIds: context.snapshotIds,
		...payload,
	});
};

const deleteSnapshots = async (context: DeleteSnapshotsTaskContext): Promise<DeleteSnapshotsTaskResult> => {
	const organizationId = context.repository.organizationId;
	const repositoryCachePrefix = cacheKeys.repository.all(context.repository.id);
	const releaseLock = await repoMutex.acquireExclusive(context.repository.id, "delete:snapshots");

	try {
		await runEffectPromise(
			restic.deleteSnapshots(context.repository.config, context.snapshotIds, {
				organizationId,
			}),
		);
		cache.delByPrefix(repositoryCachePrefix);
	} finally {
		releaseLock();
	}

	return { kind: "deleteSnapshots", deletedSnapshotIds: context.snapshotIds };
};

export const createDeleteSnapshotsCommand = (params: DeleteSnapshotsCommandParams) => {
	return {
		start: () => {
			const task = taskStore.create({
				organizationId: params.repository.organizationId,
				resourceType: "repository",
				resourceId: params.repository.shortId,
				input: {
					kind: "deleteSnapshots",
					repositoryId: params.repository.shortId,
					snapshotIds: params.snapshotIds,
				},
			});

			const context = {
				repository: params.repository,
				snapshotIds: params.snapshotIds,
				taskId: task.id,
			};

			void runTaskLifecycle({
				taskId: task.id,
				label: "snapshot deletion task",
				run: () => deleteSnapshots(context),
				onStarted: () => emitDeleteSnapshotsStarted(context),
				onSucceeded: () => {
					emitDeleteSnapshotsCompleted(context, { status: "success" });
					void refreshStoredRepositoryStats(params.repository).catch((error) => {
						logger.error(
							`Failed to refresh repository stats after snapshot deletion for ${params.repository.shortId}: ${toMessage(error)}`,
						);
					});
				},
				onFailed: (_task, errorMessage) => {
					emitDeleteSnapshotsCompleted(context, { status: "error", error: errorMessage });
				},
			});

			return { taskId: task.id, status: "started" as const };
		},
	};
};
