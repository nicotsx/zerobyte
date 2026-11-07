import { queryOptions } from "@tanstack/react-query";
import { listTasks, type ListTasksData } from "~/client/api-client";
import { activeTaskStatuses, taskDtoSchema, type TaskDto, type TaskKind } from "~/schemas/tasks";

export type TaskEventsQuery = NonNullable<ListTasksData["query"]>;
export type TaskOfKind<K extends TaskKind> = TaskDto & {
	kind: K;
	input: Extract<TaskDto["input"], { kind: K }>;
	progress: Extract<NonNullable<TaskDto["progress"]>, { kind: K }> | null;
	result: Extract<NonNullable<TaskDto["result"]>, { kind: K }> | null;
};

export type TaskForQuery<Q extends TaskEventsQuery> = Q extends { kind: infer K extends TaskKind }
	? TaskOfKind<K>
	: TaskDto;

export const isTaskActive = (task: Pick<TaskDto, "status">) => {
	return activeTaskStatuses.some((status) => status === task.status);
};

export const matchesTaskQuery = <Q extends TaskEventsQuery>(task: TaskDto, query: Q): task is TaskForQuery<Q> => {
	if (query.kind && task.kind !== query.kind) return false;
	if (query.resourceType && task.resourceType !== query.resourceType) return false;
	if (query.resourceId && task.resourceId !== query.resourceId) return false;
	if (query.operationKey && task.operationKey !== query.operationKey) return false;

	return true;
};

export const activeTasksOptions = () => {
	return queryOptions({
		queryKey: ["active-tasks"] as const,
		queryFn: async ({ signal }) => {
			const response = await listTasks({ signal, throwOnError: true });
			return response.data.map((task) => taskDtoSchema.parse(task));
		},
		staleTime: "static",
	});
};

export const taskEventsOptions = <const Q extends TaskEventsQuery>(query: Q) => {
	return queryOptions({
		...activeTasksOptions(),
		select: (tasks) => tasks.filter((task) => matchesTaskQuery(task, query)),
	});
};
