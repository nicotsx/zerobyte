import { useCallback, useState } from "react";
import type { ListTasksResponse } from "~/client/api-client";
import {
	isTaskActive,
	taskEventsOptions,
	useActiveTasks,
	type TaskEventsQuery,
	type TaskOfKind,
} from "~/client/hooks/use-active-tasks";
import { useTask } from "~/client/hooks/use-task";

export type RestoreTask = TaskOfKind<"restore">;

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

export const getActiveRestoreTask = (tasks: ListTasksResponse): RestoreTask | null => {
	const task = tasks[0];
	if (!task || task.kind !== "restore" || task.input.kind !== "restore") {
		return null;
	}

	return task as RestoreTask;
};

const latestTask = (tasks: Array<RestoreTask | null>) =>
	tasks.reduce<RestoreTask | null>((latest, task) => {
		if (!task) return latest;
		if (!latest || task.updatedAt > latest.updatedAt) return task;
		if (task.updatedAt === latest.updatedAt && task.id >= latest.id) return task;
		return latest;
	}, null);

export const useRestoreTask = (
	repositoryId: string,
	snapshotId: string,
	startedTaskId?: string,
	initialActiveTask?: RestoreTask | null,
) => {
	const [lastFinishedTask, setLastFinishedTask] = useState<RestoreTask | null>(null);
	const filter = restoreTasksFilter(repositoryId, snapshotId);
	const { data: activeRestoreTasks } = useActiveTasks(filter, {
		initialTasks: initialActiveTask ? [initialActiveTask] : undefined,
		onTaskFinished: setLastFinishedTask,
	});
	const { task: startedTask } = useTask<RestoreTask>(startedTaskId);
	const restoreTask = latestTask([startedTask, activeRestoreTasks?.[0] ?? null, lastFinishedTask]);
	const activeRestoreTaskId =
		restoreTask && isTaskActive(restoreTask)
			? restoreTask.id
			: restoreTask === null && startedTaskId !== undefined
				? startedTaskId
				: null;
	const taskIsActive = restoreTask !== null && activeRestoreTaskId === restoreTask.id;

	const clearFinishedRestoreTask = useCallback(() => {
		setLastFinishedTask(null);
	}, []);

	return {
		restoreProgress: taskIsActive ? (restoreTask?.progress?.progress ?? null) : null,
		finishedRestoreTask: restoreTask && !taskIsActive ? restoreTask : null,
		clearFinishedRestoreTask,
		activeRestoreTaskId,
		isRestoreRunning: activeRestoreTaskId !== null,
	};
};
