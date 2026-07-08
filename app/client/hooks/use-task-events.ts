import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { listTasksOptions } from "~/client/api-client/@tanstack/react-query.gen";
import type { ListTasksResponse } from "~/client/api-client";
import { logger } from "~/client/lib/logger";
import { taskChangedEventName } from "~/schemas/task-events";
import type { TaskDto } from "~/schemas/tasks";

type UseTaskEventsOptions = {
	enabled?: boolean;
};

type TrackedTask = ListTasksResponse[number];
type ListTasksQueryOptions = ReturnType<typeof listTasksOptions>;
type UseActiveTaskEventsOptions<TTask extends TrackedTask> = {
	onTaskFinished?: (task: TTask) => void;
};
type UseTaskEventSubscriptionsOptions = {
	onError?: (taskId: string) => void;
};

const emptyActiveTasks: TrackedTask[] = [];

const parseTaskEvent = (event: Event): TaskDto => {
	return JSON.parse((event as MessageEvent<string>).data) as TaskDto;
};

export const useTaskEventSubscriptions = <TTask = TaskDto>(
	taskIds: string[],
	onTaskChanged: (task: TTask) => void,
	options: UseTaskEventSubscriptionsOptions = {},
) => {
	const onTaskChangedRef = useRef(onTaskChanged);
	const onErrorRef = useRef(options.onError);
	const sortedTaskIds = useMemo(() => {
		const uniqueTaskIds = Array.from(new Set(taskIds));
		uniqueTaskIds.sort();
		return uniqueTaskIds;
	}, [taskIds]);
	const sortedTaskIdKey = sortedTaskIds.join("\0");
	const sortedTaskIdsRef = useRef(sortedTaskIds);
	onTaskChangedRef.current = onTaskChanged;
	onErrorRef.current = options.onError;
	sortedTaskIdsRef.current = sortedTaskIds;

	useEffect(() => {
		const taskEventSources = new Map<string, EventSource>();
		const currentTaskIds = sortedTaskIdsRef.current;

		for (const taskId of currentTaskIds) {
			const eventSource = new EventSource(`/api/v1/tasks/${taskId}/events`);
			eventSource.addEventListener(taskChangedEventName, (event) => {
				const task = parseTaskEvent(event) as unknown as TTask;
				onTaskChangedRef.current(task);
			});

			eventSource.onerror = (error) => {
				logger.error(`[SSE] Task ${taskId} connection error:`, error);
				onErrorRef.current?.(taskId);
			};

			taskEventSources.set(taskId, eventSource);
		}

		return () => {
			for (const eventSource of taskEventSources.values()) {
				eventSource.close();
			}
		};
	}, [sortedTaskIdKey]);
};

const isActiveTask = (task: TrackedTask) => {
	return task.status === "queued" || task.status === "running" || task.status === "cancelling";
};

const getTaskIds = (tasks: TrackedTask[]) => {
	return tasks.map((task) => task.id);
};

export const useActiveTaskEvents = <TTask extends TrackedTask = TrackedTask>(
	queryOptions: ListTasksQueryOptions,
	options: UseActiveTaskEventsOptions<TTask> = {},
) => {
	const queryClient = useQueryClient();
	const tasks = useQuery(queryOptions);
	const activeTasks = tasks.data ?? emptyActiveTasks;
	const taskIds = useMemo(() => getTaskIds(activeTasks), [activeTasks]);
	const onTaskFinishedRef = useRef(options.onTaskFinished);
	onTaskFinishedRef.current = options.onTaskFinished;

	useTaskEventSubscriptions<TTask>(
		taskIds,
		(task) => {
			let didFinishTask = false;
			queryClient.setQueryData<ListTasksResponse>(queryOptions.queryKey, (currentTasks) => {
				if (!currentTasks) {
					return currentTasks;
				}

				const currentTask = currentTasks.find((entry) => entry.id === task.id);
				const shouldReplaceTask = !currentTask || task.updatedAt >= currentTask.updatedAt;
				if (!shouldReplaceTask) {
					return currentTasks;
				}

				if (isActiveTask(task)) {
					if (!currentTask) {
						return [task, ...currentTasks];
					}

					return currentTasks.map((entry) => (entry.id === task.id ? task : entry));
				}

				didFinishTask = Boolean(currentTask);
				return currentTasks.filter((entry) => entry.id !== task.id);
			});

			if (didFinishTask) {
				onTaskFinishedRef.current?.(task);
			}
		},
		{
			onError: () => {
				void queryClient.invalidateQueries({ queryKey: queryOptions.queryKey });
			},
		},
	);

	return tasks;
};

export const useTaskEvents = (taskId: string | null | undefined, options: UseTaskEventsOptions = {}) => {
	const enabled = options.enabled ?? true;
	const [task, setTask] = useState<TaskDto | null>(null);
	const taskIds = enabled && taskId ? [taskId] : [];

	useTaskEventSubscriptions(taskIds, (nextTask) => {
		setTask((currentTask) => {
			const shouldReplaceTask = !currentTask || nextTask.updatedAt >= currentTask.updatedAt;
			if (!shouldReplaceTask) {
				return currentTask;
			}

			return nextTask;
		});
	});

	useEffect(() => {
		if (!enabled || !taskId) {
			setTask(null);
			return;
		}

		setTask(null);
	}, [enabled, taskId]);

	return { task };
};
