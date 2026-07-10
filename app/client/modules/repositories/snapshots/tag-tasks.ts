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
import type { BackupSchedule } from "~/client/lib/types";

type TagSnapshotsTask = TaskOfKind<"tagSnapshots">;

const emptyTaggingSnapshotIds = new Set<string>();

const tagSnapshotTasksFilter = (repositoryId: string) => {
	return {
		kind: "tagSnapshots",
		resourceType: "repository",
		resourceId: repositoryId,
	} satisfies TaskEventsQuery;
};

const applyTaskTagsToSnapshot = (snapshot: ListSnapshotsResponse[number], task: TagSnapshotsTask) => {
	if (task.input.set) {
		return { ...snapshot, tags: Array.from(new Set(task.input.set)) };
	}

	let tags = snapshot.tags;

	if (task.input.add?.length) {
		tags = Array.from(new Set([...tags, ...task.input.add]));
	}

	if (task.input.remove?.length) {
		const removedTags = new Set(task.input.remove);
		tags = tags.filter((tag) => !removedTags.has(tag));
	}

	return { ...snapshot, tags };
};

const updateTaggedSnapshotsInCache = (queryClient: QueryClient, repositoryId: string, task: TagSnapshotsTask) => {
	const taggedSnapshotIds = new Set(task.result?.taggedSnapshotIds ?? task.input.snapshotIds);
	const queryKeyPrefix = listSnapshotsQueryKey({ path: { shortId: repositoryId } });
	const cachedQueries = queryClient.getQueriesData<ListSnapshotsResponse>({ queryKey: queryKeyPrefix });
	const updatedSnapshots = new Map<string, ListSnapshotsResponse[number]>();

	for (const [, snapshots] of cachedQueries) {
		if (!snapshots) {
			continue;
		}

		for (const snapshot of snapshots) {
			if (!taggedSnapshotIds.has(snapshot.short_id) || updatedSnapshots.has(snapshot.short_id)) {
				continue;
			}

			updatedSnapshots.set(snapshot.short_id, applyTaskTagsToSnapshot(snapshot, task));
		}
	}

	for (const [queryKey, snapshots] of cachedQueries) {
		if (!snapshots) {
			continue;
		}

		const queryOptions = Array.isArray(queryKey) ? queryKey[0] : null;
		const backupId =
			typeof queryOptions === "object" && queryOptions && "query" in queryOptions
				? (queryOptions as { query?: { backupId?: string } }).query?.backupId
				: undefined;

		const nextSnapshots = snapshots
			.map((snapshot) => updatedSnapshots.get(snapshot.short_id) ?? snapshot)
			.filter((snapshot) => !backupId || snapshot.tags.includes(backupId));

		if (backupId) {
			const presentSnapshotIds = new Set(nextSnapshots.map((snapshot) => snapshot.short_id));

			for (const snapshot of updatedSnapshots.values()) {
				if (!snapshot.tags.includes(backupId) || presentSnapshotIds.has(snapshot.short_id)) {
					continue;
				}

				nextSnapshots.push(snapshot);
			}
		}

		queryClient.setQueryData<ListSnapshotsResponse>(queryKey, nextSnapshots);
	}
};

const getTagSnapshotsSuccessMessage = (task: TagSnapshotsTask, backups: BackupSchedule[]) => {
	const targetScheduleId = task.input.set?.length === 1 ? task.input.set[0] : null;
	const targetSchedule = targetScheduleId ? backups.find((backup) => backup.shortId === targetScheduleId) : null;

	if (targetSchedule) {
		return `Snapshots re-tagged to ${targetSchedule.name}`;
	}

	const isSingleSnapshot = task.input.snapshotIds.length === 1;
	return isSingleSnapshot ? "Snapshot re-tagged" : "Snapshots re-tagged";
};

const applyTagSnapshotsTaskFinished = (queryClient: QueryClient, task: TagSnapshotsTask, backups: BackupSchedule[]) => {
	const isSingleSnapshot = task.input.snapshotIds.length === 1;

	if (task.status === "succeeded") {
		const message = getTagSnapshotsSuccessMessage(task, backups);
		updateTaggedSnapshotsInCache(queryClient, task.input.repositoryId, task);
		toast.success(message);
		return;
	}

	const message = isSingleSnapshot ? "Failed to re-tag snapshot" : "Failed to re-tag snapshots";
	const description = task.error ?? undefined;
	toast.error(message, { description });
};

export const tagSnapshotTasksOptions = (repositoryId: string) => {
	const filter = tagSnapshotTasksFilter(repositoryId);
	return taskEventsOptions(filter);
};

export const useTaggingSnapshots = (repositoryId: string, backups: BackupSchedule[]) => {
	const queryClient = useQueryClient();
	const filter = tagSnapshotTasksFilter(repositoryId);
	const tagTasks = useActiveTasks(filter, {
		onTaskFinished: (task) => applyTagSnapshotsTaskFinished(queryClient, task, backups),
	});

	const taggingSnapshotIds = useMemo(() => {
		if (!tagTasks.data) {
			return emptyTaggingSnapshotIds;
		}

		const snapshotIds = new Set<string>();
		for (const task of tagTasks.data) {
			for (const snapshotId of task.input.snapshotIds) {
				snapshotIds.add(snapshotId);
			}
		}

		return snapshotIds;
	}, [tagTasks.data]);

	return {
		taggingSnapshotIds,
	};
};
