import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListTasksData, ListTasksResponse } from "~/client/api-client";
import { getTaskOptions, listTasksOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { logger } from "~/client/lib/logger";
import { taskChangedEventName, tasksSnapshotEventName } from "~/schemas/task-events";
import { activeTaskStatuses, type TaskDto } from "~/schemas/tasks";

export type TaskEventsQuery = NonNullable<ListTasksData["query"]>;
type UseTaskEventsOptions = {
	onTaskFinished?: (task: TaskDto) => void;
};

const parseTaskEvent = (event: Event): TaskDto => {
	return JSON.parse((event as MessageEvent<string>).data) as TaskDto;
};

const parseTasksSnapshotEvent = (event: Event): TaskDto[] => {
	return JSON.parse((event as MessageEvent<string>).data) as TaskDto[];
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

const hasTaskFinished = (finishedTasks: Map<string, TaskDto>, task: TaskDto) => {
	const finishedTask = finishedTasks.get(task.id);
	return !!finishedTask && finishedTask.updatedAt >= task.updatedAt;
};

export const taskEventsOptions = (query: TaskEventsQuery) => {
	return listTasksOptions({ query });
};

export const useTaskEvents = (query: TaskEventsQuery, options: UseTaskEventsOptions = {}) => {
	const queryClient = useQueryClient();
	const onTaskFinishedRef = useRef(options.onTaskFinished);
	const finishedTasksRef = useRef(new Map<string, TaskDto>());
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

	const taskQueryKeyRef = useRef(taskListOptions.queryKey);
	taskQueryKeyRef.current = taskListOptions.queryKey;

	const tasks = useQuery({ ...taskListOptions, enabled: false });

	useEffect(() => {
		const eventSource = new EventSource(taskEventsUrl);

		eventSource.addEventListener(tasksSnapshotEventName, (event) => {
			const snapshot = parseTasksSnapshotEvent(event);
			const currentTasks = queryClient.getQueryData<ListTasksResponse>(taskQueryKeyRef.current) ?? [];

			const snapshotTaskIds = new Set(snapshot.map((task) => task.id));
			const missingTasks = currentTasks.filter((task) => !snapshotTaskIds.has(task.id));

			queryClient.setQueryData<ListTasksResponse>(
				taskQueryKeyRef.current,
				snapshot.filter((task) => !hasTaskFinished(finishedTasksRef.current, task)),
			);

			for (const missingTask of missingTasks) {
				void queryClient
					.fetchQuery(getTaskOptions({ path: { taskId: missingTask.id } }))
					.then((task) => {
						const fetchedTask = task as TaskDto;
						if (
							isActiveTask(fetchedTask) ||
							fetchedTask.updatedAt < missingTask.updatedAt ||
							hasTaskFinished(finishedTasksRef.current, fetchedTask)
						) {
							return;
						}

						finishedTasksRef.current.set(fetchedTask.id, fetchedTask);
						onTaskFinishedRef.current?.(fetchedTask);
					})
					.catch((error: unknown) => {
						logger.error("[SSE] Failed to reconcile missing task:", error);
					});
			}
		});

		eventSource.addEventListener(taskChangedEventName, (event) => {
			const task = parseTaskEvent(event);
			const activeTasks = queryClient.getQueryData<ListTasksResponse>(taskQueryKeyRef.current) ?? [];

			if (isActiveTask(task)) {
				if (hasTaskFinished(finishedTasksRef.current, task)) {
					return;
				}

				queryClient.setQueryData<ListTasksResponse>(taskQueryKeyRef.current, upsertTask(activeTasks, task));
				return;
			}

			const currentTask = activeTasks.find((entry) => entry.id === task.id);
			if (currentTask && task.updatedAt < currentTask.updatedAt) {
				return;
			}

			queryClient.setQueryData<ListTasksResponse>(
				taskQueryKeyRef.current,
				activeTasks.filter((entry) => entry.id !== task.id),
			);

			if (hasTaskFinished(finishedTasksRef.current, task)) {
				return;
			}

			finishedTasksRef.current.set(task.id, task);
			onTaskFinishedRef.current?.(task);
		});

		eventSource.onerror = (error) => {
			logger.error("[SSE] Task stream connection error:", error);
		};

		return () => {
			eventSource.close();
		};
	}, [queryClient, taskEventsUrl]);

	return tasks;
};
