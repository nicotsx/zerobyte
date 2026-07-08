import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListTasksData, ListTasksResponse } from "~/client/api-client";
import { listTasksOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { logger } from "~/client/lib/logger";
import { taskChangedEventName, tasksSnapshotEventName } from "~/schemas/task-events";
import { activeTaskStatuses, type TaskDto } from "~/schemas/tasks";

type TaskEventsQuery = NonNullable<ListTasksData["query"]>;
type UseTaskEventsOptions = {
	onTaskFinished?: (task: TaskDto) => void;
};

const parseTaskEvent = (event: Event): TaskDto => {
	return JSON.parse((event as MessageEvent<string>).data) as TaskDto;
};

const parseTasksSnapshotEvent = (event: Event): ListTasksResponse => {
	return JSON.parse((event as MessageEvent<string>).data) as ListTasksResponse;
};

const isActiveTask = (task: TaskDto) => {
	return activeTaskStatuses.some((status) => status === task.status);
};

const getTasksEventUrl = (query: TaskEventsQuery) => {
	const params = new URLSearchParams();
	if (query.kind) params.set("kind", query.kind);
	if (query.resourceType) params.set("resourceType", query.resourceType);
	if (query.resourceId) params.set("resourceId", query.resourceId);

	const queryString = params.toString();
	if (!queryString) {
		return "/api/v1/tasks/events";
	}

	return `/api/v1/tasks/events?${queryString}`;
};

const upsertTask = (tasks: ListTasksResponse, task: TaskDto) => {
	const currentTask = tasks.find((entry) => entry.id === task.id);
	if (!currentTask) {
		return [task, ...tasks];
	}

	const shouldReplaceTask = task.updatedAt >= currentTask.updatedAt;
	if (!shouldReplaceTask) {
		return tasks;
	}

	return tasks.map((entry) => (entry.id === task.id ? task : entry));
};

export const taskEventsOptions = (query: TaskEventsQuery) => {
	return listTasksOptions({ query });
};

export const useTaskEvents = (query: TaskEventsQuery, options: UseTaskEventsOptions = {}) => {
	const queryClient = useQueryClient();
	const onTaskFinishedRef = useRef(options.onTaskFinished);
	const queryKind = query.kind;
	const queryResourceType = query.resourceType;
	const queryResourceId = query.resourceId;
	onTaskFinishedRef.current = options.onTaskFinished;

	const taskListOptions = useMemo(() => {
		return taskEventsOptions({
			kind: queryKind,
			resourceType: queryResourceType,
			resourceId: queryResourceId,
		});
	}, [queryKind, queryResourceId, queryResourceType]);

	const taskEventsUrl = useMemo(() => {
		return getTasksEventUrl({
			kind: queryKind,
			resourceType: queryResourceType,
			resourceId: queryResourceId,
		});
	}, [queryKind, queryResourceId, queryResourceType]);

	const tasks = useQuery({ ...taskListOptions, enabled: false });

	useEffect(() => {
		const eventSource = new EventSource(taskEventsUrl);

		eventSource.addEventListener(tasksSnapshotEventName, (event) => {
			const snapshot = parseTasksSnapshotEvent(event);
			queryClient.setQueryData<ListTasksResponse>(taskListOptions.queryKey, snapshot);
		});

		eventSource.addEventListener(taskChangedEventName, (event) => {
			const task = parseTaskEvent(event);
			let finishedTask: TaskDto | null = null;

			queryClient.setQueryData<ListTasksResponse>(taskListOptions.queryKey, (currentTasks) => {
				const activeTasks = currentTasks ?? [];
				if (isActiveTask(task)) {
					return upsertTask(activeTasks, task);
				}

				finishedTask = task;
				return activeTasks.filter((entry) => entry.id !== task.id);
			});

			if (finishedTask) {
				onTaskFinishedRef.current?.(finishedTask);
			}
		});

		eventSource.onerror = (error) => {
			logger.error("[SSE] Task stream connection error:", error);
		};

		return () => {
			eventSource.close();
		};
	}, [queryClient, taskEventsUrl, taskListOptions.queryKey]);

	return tasks;
};
