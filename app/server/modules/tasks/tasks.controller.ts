import { Hono } from "hono";
import { validator } from "hono-openapi";
import { NotFoundError } from "http-errors-enhanced";
import {
	taskChangedEventName,
	taskEventNames,
	type TaskEventName,
	type TaskEventPayloadMap,
} from "~/schemas/task-events";
import { streamEvents } from "../events/server-event-stream";
import { requireAuth } from "../auth/auth.middleware";
import {
	getTaskDto,
	listTasksDto,
	listTasksQuery,
	streamTaskEventsDto,
	type GetTaskDto,
	type ListTasksDto,
} from "./tasks.dto";
import { toTaskDto } from "./tasks.presenter";
import { taskStore } from "./tasks.store";

export const tasksController = new Hono()
	.use(requireAuth)
	.get("/", validator("query", listTasksQuery), listTasksDto, async (c) => {
		const organizationId = c.get("organizationId");
		const { kind } = c.req.valid("query");
		const tasks = taskStore.listActive({ organizationId, kind });
		const response = tasks.map(toTaskDto);

		return c.json<ListTasksDto>(response, 200);
	})
	.get("/:taskId/events", streamTaskEventsDto, async (c) => {
		const organizationId = c.get("organizationId");
		const taskId = c.req.param("taskId");
		const task = taskStore.findById({ organizationId, taskId });

		if (!task) {
			throw new NotFoundError("Task not found");
		}

		return streamEvents<TaskEventPayloadMap, TaskEventName>(c, {
			connectionLabel: `task ${taskId}`,
			events: taskEventNames,
			onConnected: async (stream) => {
				const currentTask = taskStore.findById({ organizationId, taskId });
				if (!currentTask) return;
				const taskData = toTaskDto(currentTask);

				await stream.writeSSE({
					data: JSON.stringify(taskData),
					event: taskChangedEventName,
				});
			},
			subscribe: (eventName, handler) => {
				switch (eventName) {
					case taskChangedEventName:
						return taskStore.subscribeToChanges(taskId, (changedTask) => {
							const taskData = toTaskDto(changedTask);
							void handler(taskData);
						});
					default: {
						const _exhaustive: never = eventName;
						throw new Error(`Unsupported task event: ${_exhaustive}`);
					}
				}
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
