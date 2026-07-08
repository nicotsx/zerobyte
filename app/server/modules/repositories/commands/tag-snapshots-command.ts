import { repoMutex } from "../../../core/repository-mutex";
import { restic } from "../../../core/restic";
import type { Repository } from "../../../db/schema";
import { cache, cacheKeys } from "../../../utils/cache";
import { runEffectPromise } from "../../../utils/errors";
import { runTaskLifecycle } from "../../tasks/tasks.lifecycle";
import { taskStore } from "../../tasks/tasks.store";
import type { TaskResult } from "~/schemas/tasks";

type TagSnapshotsTaskResult = Extract<TaskResult, { kind: "tagSnapshots" }>;

type TagSnapshotsCommandParams = {
	repository: Repository;
	snapshotIds: string[];
	tags: { add?: string[]; remove?: string[]; set?: string[] };
};

const tagSnapshots = async (params: TagSnapshotsCommandParams): Promise<TagSnapshotsTaskResult> => {
	const organizationId = params.repository.organizationId;
	const repositoryCachePrefix = cacheKeys.repository.all(params.repository.id);
	const releaseLock = await repoMutex.acquireExclusive(params.repository.id, "tag:snapshots");

	try {
		await runEffectPromise(
			restic.tagSnapshots(params.repository.config, params.snapshotIds, params.tags, { organizationId }),
		);
		cache.delByPrefix(repositoryCachePrefix);
	} finally {
		releaseLock();
	}

	return { kind: "tagSnapshots", taggedSnapshotIds: params.snapshotIds };
};

export const createTagSnapshotsCommand = (params: TagSnapshotsCommandParams) => {
	return {
		start: () => {
			const task = taskStore.create({
				organizationId: params.repository.organizationId,
				resourceType: "repository",
				resourceId: params.repository.shortId,
				input: {
					kind: "tagSnapshots",
					repositoryId: params.repository.shortId,
					snapshotIds: params.snapshotIds,
					...params.tags,
				},
			});

			void runTaskLifecycle({
				taskId: task.id,
				label: "snapshot tag task",
				run: () => tagSnapshots(params),
			});

			return { taskId: task.id, status: "started" as const };
		},
	};
};
