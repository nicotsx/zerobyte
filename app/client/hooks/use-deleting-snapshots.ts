import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ListTasksResponse } from "~/client/api-client";
import { listTasksOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { removeSnapshotsFromListSnapshotsCache } from "~/client/modules/repositories/snapshot-cache";
import { useActiveTaskEvents } from "./use-task-events";

type TrackedTask = ListTasksResponse[number];

const emptyDeletingSnapshotIds = new Set<string>();

export const useDeletingSnapshots = (repositoryId: string) => {
	const queryClient = useQueryClient();
	const deleteTasksOptions = listTasksOptions({
		query: {
			kind: "deleteSnapshots",
			resourceType: "repository",
			resourceId: repositoryId,
		},
	});

	const handleDeleteTaskFinished = (task: TrackedTask) => {
		if (task.input.kind !== "deleteSnapshots") {
			return;
		}

		const isSingleSnapshot = task.input.snapshotIds.length === 1;

		if (task.status === "succeeded") {
			const result = task.result?.kind === "deleteSnapshots" ? task.result : null;
			const deletedSnapshotIds = result?.deletedSnapshotIds ?? task.input.snapshotIds;
			const message = isSingleSnapshot ? "Snapshot deleted" : "Snapshots deleted";
			removeSnapshotsFromListSnapshotsCache(queryClient, repositoryId, deletedSnapshotIds);
			toast.success(message);
			return;
		}

		const message = isSingleSnapshot ? "Failed to delete snapshot" : "Failed to delete snapshots";
		toast.error(message, { description: task.error ?? undefined });
	};

	const deleteTasks = useActiveTaskEvents<TrackedTask>(deleteTasksOptions, {
		onTaskFinished: handleDeleteTaskFinished,
	});

	const deletingSnapshotIds = useMemo(() => {
		if (!deleteTasks.data) {
			return emptyDeletingSnapshotIds;
		}

		const snapshotIds = new Set<string>();

		for (const task of deleteTasks.data) {
			if (task.input.kind !== "deleteSnapshots") {
				continue;
			}

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
