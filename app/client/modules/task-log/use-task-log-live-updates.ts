import { useCallback, useEffect, useRef, useState } from "react";
import type { ListTaskHistoryResponse } from "~/client/api-client";
import { isTaskActive, useActiveTasks } from "~/client/hooks/use-active-tasks";
import type { TaskDto } from "~/schemas/tasks";
import type { TaskLogKind, TaskLogOutcome } from "./task-log-shared";

type UseTaskLogLiveUpdatesParams = {
	kind?: TaskLogKind;
	outcome?: TaskLogOutcome;
	page: number;
	viewKey: string;
	history?: ListTaskHistoryResponse;
	refetch: () => Promise<unknown>;
};

const hasMatchingLifecycle = (item: ListTaskHistoryResponse["items"][number], task: TaskDto) => {
	return item.status === task.status && item.startedAt === task.startedAt && item.finishedAt === task.finishedAt;
};

const snapshotChangesHistory = (
	snapshot: TaskDto[],
	history: ListTaskHistoryResponse | undefined,
	page: number,
	outcome: TaskLogOutcome | undefined,
) => {
	if (!history || (outcome && outcome !== "running")) return false;

	const visibleItemsById = new Map(history.items.map((item) => [item.id, item]));
	const snapshotById = new Map(snapshot.map((task) => [task.id, task]));
	const hasChangedVisibleTask = history.items.some((item) => {
		if (!isTaskActive(item)) return false;
		const activeTask = snapshotById.get(item.id);
		return !activeTask || !hasMatchingLifecycle(item, activeTask);
	});
	if (hasChangedVisibleTask) return true;

	const oldestVisibleItem = history.items.at(-1);
	return snapshot.some((task) => {
		const visibleItem = visibleItemsById.get(task.id);
		if (visibleItem) return !hasMatchingLifecycle(visibleItem, task);
		if (page > 1 || history.items.length < history.pageSize || !oldestVisibleItem) return true;

		return (
			task.createdAt > oldestVisibleItem.createdAt ||
			(task.createdAt === oldestVisibleItem.createdAt && task.id > oldestVisibleItem.id)
		);
	});
};

export const useTaskLogLiveUpdates = ({
	kind,
	outcome,
	page,
	viewKey,
	history,
	refetch,
}: UseTaskLogLiveUpdatesParams) => {
	const [hasNewActivity, setHasNewActivity] = useState(false);
	const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const refreshLatestPage = useCallback(() => {
		clearTimeout(refreshTimerRef.current);
		refreshTimerRef.current = setTimeout(() => void refetch(), 200);
	}, [refetch]);

	const handleTaskActivity = useCallback(() => {
		if (page === 1) {
			refreshLatestPage();
			return;
		}

		setHasNewActivity(true);
	}, [page, refreshLatestPage]);
	const handleTasksSnapshot = useCallback(
		(snapshot: TaskDto[]) => {
			if (!history) {
				if (page === 1) refreshLatestPage();
				return;
			}
			if (snapshotChangesHistory(snapshot, history, page, outcome)) handleTaskActivity();
		},
		[handleTaskActivity, history, outcome, page, refreshLatestPage],
	);

	useActiveTasks(
		{ kind },
		{
			onTaskActivity: handleTaskActivity,
			onTasksSnapshot: handleTasksSnapshot,
		},
	);

	useEffect(() => {
		return () => clearTimeout(refreshTimerRef.current);
	}, [viewKey]);
	const clearNewActivity = useCallback(() => setHasNewActivity(false), []);

	return {
		newActivity: page > 1 && hasNewActivity,
		clearNewActivity,
	};
};
