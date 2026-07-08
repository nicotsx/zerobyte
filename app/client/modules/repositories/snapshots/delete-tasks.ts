import { useMemo } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ListSnapshotsResponse, ListTasksData } from "~/client/api-client";
import { listSnapshotsQueryKey } from "~/client/api-client/@tanstack/react-query.gen";
import { taskEventsOptions, useTaskEvents } from "~/client/hooks/use-task-events";
import type { TaskDto } from "~/schemas/tasks";

type DeleteSnapshotsTaskInput = Extract<TaskDto["input"], { kind: "deleteSnapshots" }>;
type DeleteSnapshotsTaskResult = Extract<NonNullable<TaskDto["result"]>, { kind: "deleteSnapshots" }>;
type DeleteSnapshotsTask = TaskDto & {
	input: DeleteSnapshotsTaskInput;
	result: DeleteSnapshotsTaskResult | null;
};
type DeleteSnapshotTasksFilter = NonNullable<ListTasksData["query"]>;

const emptyDeletingSnapshotIds = new Set<string>();

const deleteSnapshotTasksFilter = (repositoryId: string): DeleteSnapshotTasksFilter => {
	return {
		kind: "deleteSnapshots",
		resourceType: "repository",
		resourceId: repositoryId,
	};
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
	const deleteTasks = useTaskEvents(filter, {
		onTaskFinished: (task) => applyDeleteSnapshotsTaskFinished(queryClient, task as DeleteSnapshotsTask),
	});

	const deletingSnapshotIds = useMemo(() => {
		if (!deleteTasks.data) {
			return emptyDeletingSnapshotIds;
		}

		const snapshotIds = new Set<string>();
		const deleteSnapshotTasks = deleteTasks.data as DeleteSnapshotsTask[];

		for (const task of deleteSnapshotTasks) {
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
