import { Hono } from "hono";
import { validator } from "hono-openapi";
import { NotFoundError } from "http-errors-enhanced";
import { taskChangedEventName, tasksSnapshotEventName, type TaskEventPayloadMap } from "~/schemas/task-events";
import { streamEvents } from "../events/server-event-stream";
import { requireAuth } from "../auth/auth.middleware";
import {
	getTaskDto,
	listTasksDto,
	listTasksQuery,
	streamTaskEventsDto,
	streamTasksEventsDto,
	type GetTaskDto,
	type ListTasksDto,
} from "./tasks.dto";
import { toTaskDto } from "./tasks.presenter";
import { taskStore } from "./tasks.store";

type TaskFilter = NonNullable<Parameters<typeof taskStore.listActive>[0]>;

const taskMatchesFilter = (task: ReturnType<typeof taskStore.listActive>[number], filter: TaskFilter) => {
	if (filter.organizationId && task.organizationId !== filter.organizationId) {
		return false;
	}

	if (filter.kind && task.kind !== filter.kind) {
		return false;
	}

	if (filter.resourceType && task.resourceType !== filter.resourceType) {
		return false;
	}

	if (filter.resourceId && task.resourceId !== filter.resourceId) {
		return false;
	}

	return true;
};

export const tasksController = new Hono()
	.use(requireAuth)
	.get("/", validator("query", listTasksQuery), listTasksDto, async (c) => {
		const organizationId = c.get("organizationId");
		const query = c.req.valid("query");
		const tasks = taskStore.listActive({
			organizationId,
			kind: query.kind,
			resourceType: query.resourceType,
			resourceId: query.resourceId,
		});
		const response = tasks.map(toTaskDto);

		return c.json<ListTasksDto>(response, 200);
	})
	.get("/events", validator("query", listTasksQuery), streamTasksEventsDto, async (c) => {
		const organizationId = c.get("organizationId");
		const query = c.req.valid("query");
		const filter = {
			organizationId,
			kind: query.kind,
			resourceType: query.resourceType,
			resourceId: query.resourceId,
		};

		return streamEvents<TaskEventPayloadMap, typeof taskChangedEventName>(c, {
			connectionLabel: "filtered tasks",
			events: [taskChangedEventName],
			onConnected: async (stream) => {
				const activeTasks = taskStore.listActive(filter);
				const taskData = activeTasks.map(toTaskDto);

				await stream.writeSSE({
					data: JSON.stringify(taskData),
					event: tasksSnapshotEventName,
				});
			},
			subscribe: (_eventName, handler) => {
				return taskStore.subscribeToAllChanges((changedTask) => {
					if (!taskMatchesFilter(changedTask, filter)) {
						return;
					}

					const taskData = toTaskDto(changedTask);
					void handler(taskData);
				});
			},
			shouldSend: () => true,
		});
	})
	.get("/:taskId/events", streamTaskEventsDto, async (c) => {
		const organizationId = c.get("organizationId");
		const taskId = c.req.param("taskId");
		const task = taskStore.findById({ organizationId, taskId });

		if (!task) {
			throw new NotFoundError("Task not found");
		}

		return streamEvents<TaskEventPayloadMap, typeof taskChangedEventName>(c, {
			connectionLabel: `task ${taskId}`,
			events: [taskChangedEventName],
			onConnected: async (stream) => {
				const currentTask = taskStore.findById({ organizationId, taskId });
				if (!currentTask) return;
				const taskData = toTaskDto(currentTask);

				await stream.writeSSE({
					data: JSON.stringify(taskData),
					event: taskChangedEventName,
				});
			},
			subscribe: (_eventName, handler) => {
				return taskStore.subscribeToChanges(taskId, (changedTask) => {
					const taskData = toTaskDto(changedTask);
					void handler(taskData);
				});
			},
			shouldSend: () => true,
		});
	})
	.get("/:taskId", getTaskDto, async (c) => {
		const organizationId = c.get("organizationId");
		const taskId = c.req.param("taskId");
		const task = taskStore.findById({ organizationId, taskId });

		if (!task) {
			throw new NotFoundError("Task not found");
		}

		return c.json<GetTaskDto>(toTaskDto(task), 200);
	});
