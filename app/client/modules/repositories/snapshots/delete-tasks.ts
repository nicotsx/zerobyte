import { useMemo } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ListSnapshotsResponse } from "~/client/api-client";
import { listSnapshotsQueryKey } from "~/client/api-client/@tanstack/react-query.gen";
import {
	taskEventsOptions,
	useActiveTasks,
	type TaskEventsQuery,
	type TaskOfKind,
} from "~/client/hooks/use-active-tasks";

type DeleteSnapshotsTask = TaskOfKind<"deleteSnapshots">;

const emptyDeletingSnapshotIds = new Set<string>();

const deleteSnapshotTasksFilter = (repositoryId: string) => {
	return {
		kind: "deleteSnapshots",
		resourceType: "repository",
		resourceId: repositoryId,
	} satisfies TaskEventsQuery;
};

const removeSnapshotsFromCache = (queryClient: QueryClient, repositoryId: string, snapshotIds: string[]) => {
	const deletedSnapshotIds = new Set(snapshotIds);
	const listSnapshotsQueryKeyPrefix = listSnapshotsQueryKey({ path: { shortId: repositoryId } });

	queryClient.setQueriesData<ListSnapshotsResponse>({ queryKey: listSnapshotsQueryKeyPrefix }, (snapshots) => {
		if (!snapshots) {
			return snapshots;
		}

		return snapshots.filter((snapshot) => !deletedSnapshotIds.has(snapshot.short_id));
	});
};

const applyDeleteSnapshotsTaskFinished = (queryClient: QueryClient, task: DeleteSnapshotsTask) => {
	const isSingleSnapshot = task.input.snapshotIds.length === 1;

	if (task.status === "succeeded") {
		const deletedSnapshotIds = task.result?.deletedSnapshotIds ?? task.input.snapshotIds;
		const message = isSingleSnapshot ? "Snapshot deleted" : "Snapshots deleted";
		removeSnapshotsFromCache(queryClient, task.input.repositoryId, deletedSnapshotIds);
		toast.success(message);
		return;
	}

	const message = isSingleSnapshot ? "Failed to delete snapshot" : "Failed to delete snapshots";
	const description = task.error ?? undefined;
	toast.error(message, { description });
};

export const deleteSnapshotTasksOptions = (repositoryId: string) => {
	const filter = deleteSnapshotTasksFilter(repositoryId);
	return taskEventsOptions(filter);
};

export const useDeletingSnapshots = (repositoryId: string) => {
	const queryClient = useQueryClient();
	const filter = deleteSnapshotTasksFilter(repositoryId);
	const deleteTasks = useActiveTasks(filter, {
		onTaskFinished: (task) => applyDeleteSnapshotsTaskFinished(queryClient, task),
	});

	const deletingSnapshotIds = useMemo(() => {
		if (!deleteTasks.data) {
			return emptyDeletingSnapshotIds;
		}

		const snapshotIds = new Set<string>();
		for (const task of deleteTasks.data) {
			for (const snapshotId of task.input.snapshotIds) {
				snapshotIds.add(snapshotId);
			}
		}

		return snapshotIds;
	}, [deleteTasks.data]);

	return {
		deletingSnapshotIds,
	};
};
