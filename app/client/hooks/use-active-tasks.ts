import { useEffect, useEffectEvent } from "react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { subscribeToTaskEvents } from "~/client/events/task-event-stream";
import {
	isTaskActive,
	matchesTaskQuery,
	taskEventsOptions,
	type TaskEventsQuery,
	type TaskForQuery,
} from "~/client/queries/active-tasks";
import type { TaskDto } from "~/schemas/tasks";

export { isTaskActive, taskEventsOptions, type TaskEventsQuery, type TaskOfKind } from "~/client/queries/active-tasks";

type UseActiveTasksOptions<Q extends TaskEventsQuery> = {
	onTaskActivity?: (task: TaskForQuery<Q>) => void;
	onTaskFinished?: (task: TaskForQuery<Q>) => void;
	onTasksSnapshot?: (tasks: TaskForQuery<Q>[]) => void;
};

export const useActiveTasks = <const Q extends TaskEventsQuery>(query: Q, options: UseActiveTasksOptions<Q> = {}) => {
	const queryClient = useQueryClient();

	const onSnapshot = useEffectEvent((tasks: TaskDto[]) => {
		options.onTasksSnapshot?.(tasks.filter((task) => matchesTaskQuery(task, query)));
	});

	const onTaskChanged = useEffectEvent((task: TaskDto) => {
		if (!matchesTaskQuery(task, query)) return;
		if (!isTaskActive(task)) options.onTaskFinished?.(task);
		options.onTaskActivity?.(task);
	});

	const tasks = useSuspenseQuery(taskEventsOptions(query));

	useEffect(() => {
		return subscribeToTaskEvents(queryClient, { onSnapshot, onTaskChanged });
	}, [queryClient]);

	return tasks;
};
