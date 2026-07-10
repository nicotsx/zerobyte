import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { ListTasksData, ListTasksResponse } from "~/client/api-client";
import { getTaskOptions, listTasksOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { logger } from "~/client/lib/logger";
import { taskChangedEventName, tasksSnapshotEventName } from "~/schemas/task-events";
import { activeTaskStatuses, type TaskDto, type TaskKind } from "~/schemas/tasks";

export type TaskEventsQuery = NonNullable<ListTasksData["query"]>;
export type TaskOfKind<K extends TaskKind> = TaskDto & {
	kind: K;
	input: Extract<TaskDto["input"], { kind: K }>;
	progress: Extract<NonNullable<TaskDto["progress"]>, { kind: K }> | null;
	result: Extract<NonNullable<TaskDto["result"]>, { kind: K }> | null;
};

type TaskForQuery<Q extends TaskEventsQuery> = Q extends { kind: infer K extends TaskKind } ? TaskOfKind<K> : TaskDto;

type UseActiveTasksOptions<Q extends TaskEventsQuery> = {
	onTaskFinished?: (task: TaskForQuery<Q>) => void;
};

const parseTaskEvent = (event: Event): TaskDto => {
	return JSON.parse((event as MessageEvent<string>).data) as TaskDto;
};

const parseTasksSnapshotEvent = (event: Event): TaskDto[] => {
	return JSON.parse((event as MessageEvent<string>).data) as TaskDto[];
};

export const isTaskActive = (task: Pick<TaskDto, "status">) => {
	return activeTaskStatuses.some((status) => status === task.status);
};

const getTasksEventUrl = (query: TaskEventsQuery) => {
	const params = new URLSearchParams();
	if (query.kind) params.set("kind", query.kind);
	if (query.resourceType) params.set("resourceType", query.resourceType);
	if (query.resourceId) params.set("resourceId", query.resourceId);
	if (query.operationKey) params.set("operationKey", query.operationKey);

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

export const useActiveTasks = <const Q extends TaskEventsQuery>(query: Q, options: UseActiveTasksOptions<Q> = {}) => {
	const queryClient = useQueryClient();
	const onTaskFinishedRef = useRef(options.onTaskFinished);
	const finishedTasksRef = useRef(new Map<string, TaskDto>());
	const queryKind = query.kind;
	const queryResourceType = query.resourceType;
	const queryResourceId = query.resourceId;
	const queryOperationKey = query.operationKey;
	onTaskFinishedRef.current = options.onTaskFinished;

	const taskListOptions = useMemo(() => {
		return taskEventsOptions({
			kind: queryKind,
			resourceType: queryResourceType,
			resourceId: queryResourceId,
			operationKey: queryOperationKey,
		});
	}, [queryKind, queryOperationKey, queryResourceId, queryResourceType]);

	const taskEventsUrl = useMemo(() => {
		return getTasksEventUrl({
			kind: queryKind,
			resourceType: queryResourceType,
			resourceId: queryResourceId,
			operationKey: queryOperationKey,
		});
	}, [queryKind, queryOperationKey, queryResourceId, queryResourceType]);

	const taskQueryKeyRef = useRef(taskListOptions.queryKey);
	taskQueryKeyRef.current = taskListOptions.queryKey;

	const tasks = useQuery({ ...taskListOptions, enabled: false });

	useEffect(() => {
		const finishTask = (task: TaskDto) => {
			finishedTasksRef.current.set(task.id, task);
			onTaskFinishedRef.current?.(task as TaskForQuery<Q>);
		};

		const reconcileMissingTask = async (missingTask: Pick<TaskDto, "id" | "updatedAt">) => {
			const fetchedTask = (await queryClient.fetchQuery(
				getTaskOptions({ path: { taskId: missingTask.id } }),
			)) as TaskDto;

			if (isTaskActive(fetchedTask)) return;
			if (fetchedTask.updatedAt < missingTask.updatedAt) return;
			if (hasTaskFinished(finishedTasksRef.current, fetchedTask)) return;

			finishTask(fetchedTask);
		};

		const handleTasksSnapshot = (event: Event) => {
			const snapshot = parseTasksSnapshotEvent(event);
			const currentTasks = queryClient.getQueryData<ListTasksResponse>(taskQueryKeyRef.current) ?? [];

			const snapshotTaskIds = new Set(snapshot.map((task) => task.id));
			const missingTasks = currentTasks.filter((task) => !snapshotTaskIds.has(task.id));

			queryClient.setQueryData<ListTasksResponse>(
				taskQueryKeyRef.current,
				snapshot.filter((task) => !hasTaskFinished(finishedTasksRef.current, task)),
			);

			for (const missingTask of missingTasks) {
				void reconcileMissingTask(missingTask).catch((error: unknown) => {
					logger.error("[SSE] Failed to reconcile missing task:", error);
				});
			}
		};

		const handleTaskChanged = (event: Event) => {
			const task = parseTaskEvent(event);
			const activeTasks = queryClient.getQueryData<ListTasksResponse>(taskQueryKeyRef.current) ?? [];

			if (isTaskActive(task)) {
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

			finishTask(task);
		};

		const eventSource = new EventSource(taskEventsUrl);
		eventSource.addEventListener(tasksSnapshotEventName, handleTasksSnapshot);
		eventSource.addEventListener(taskChangedEventName, handleTaskChanged);

		eventSource.onerror = (error) => {
			logger.error("[SSE] Task stream connection error:", error);
		};

		return () => {
			eventSource.close();
		};
	}, [queryClient, taskEventsUrl]);

	return tasks as UseQueryResult<TaskForQuery<Q>[]>;
};
