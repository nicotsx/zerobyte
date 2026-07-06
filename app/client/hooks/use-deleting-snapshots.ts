import { useQuery } from "@tanstack/react-query";
import type { ListTasksResponse } from "~/client/api-client";
import { listTasksOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { useServerEvents } from "./use-server-events";

const deleteSnapshotsTasksQueryOptions = {
	query: { kind: "deleteSnapshots" as const },
};

const getDeletingSnapshotIds = (tasks: ListTasksResponse, repositoryId: string) => {
	const snapshotIds = new Set<string>();

	for (const task of tasks) {
		if (task.input.kind !== "deleteSnapshots" || task.input.repositoryId !== repositoryId) {
			continue;
		}

		for (const snapshotId of task.input.snapshotIds) {
			snapshotIds.add(snapshotId);
		}
	}

	return snapshotIds;
};

export const useDeletingSnapshots = (repositoryId: string) => {
	useServerEvents();
	const tasks = useQuery(listTasksOptions(deleteSnapshotsTasksQueryOptions));

	const activeTasks = tasks.data ?? [];
	const deletingSnapshotIds = getDeletingSnapshotIds(activeTasks, repositoryId);

	return {
		deletingSnapshotIds,
	};
};
