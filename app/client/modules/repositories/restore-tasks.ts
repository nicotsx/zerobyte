import { useCallback, useState } from "react";
import {
	isTaskActive,
	taskEventsOptions,
	useActiveTasks,
	type TaskEventsQuery,
	type TaskOfKind,
} from "~/client/hooks/use-active-tasks";
import { useTask } from "~/client/hooks/use-task";

type RestoreTask = TaskOfKind<"restore">;

const restoreTasksFilter = (repositoryId: string, snapshotId: string) => {
	return {
		kind: "restore",
		resourceType: "repository",
		resourceId: repositoryId,
		operationKey: snapshotId,
	} satisfies TaskEventsQuery;
};

export const restoreTasksOptions = (repositoryId: string, snapshotId: string) => {
	return taskEventsOptions(restoreTasksFilter(repositoryId, snapshotId));
};

export const useRestoreTask = (repositoryId: string, snapshotId: string, startedTaskId?: string) => {
	const [retainedFinishedTask, setRetainedFinishedTask] = useState<RestoreTask | null>(null);
	const filter = restoreTasksFilter(repositoryId, snapshotId);
	const { data: activeRestoreTasks } = useActiveTasks(filter, {
		onTaskFinished: setRetainedFinishedTask,
	});
	const { task: exactStartedTask } = useTask<RestoreTask>(startedTaskId);
	const activeRestoreTask = activeRestoreTasks?.[0] ?? null;
	const restoreTask = exactStartedTask ?? activeRestoreTask ?? retainedFinishedTask;
	const taskIsActive = restoreTask ? isTaskActive(restoreTask) : false;
	const finishedRestoreTask = restoreTask && !taskIsActive ? restoreTask : null;

	const clearFinishedRestoreTask = useCallback(() => {
		setRetainedFinishedTask(null);
	}, []);

	const restoreProgress = taskIsActive ? (restoreTask?.progress?.progress ?? null) : null;

	return {
		restoreProgress,
		finishedRestoreTask,
		clearFinishedRestoreTask,
		isRestoreRunning: (startedTaskId !== undefined && exactStartedTask === null) || taskIsActive,
	};
};
