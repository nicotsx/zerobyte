import { z } from "zod";
import { describeRoute, resolver } from "hono-openapi";
import { taskDtoSchema, taskKindSchema } from "~/schemas/tasks";

export const listTasksQuery = z.object({
	kind: taskKindSchema.optional(),
});

export const taskResponse = taskDtoSchema;
export type TaskDto = z.infer<typeof taskResponse>;

const listTasksResponse = taskResponse.array();
export type ListTasksDto = z.infer<typeof listTasksResponse>;

export type GetTaskDto = z.infer<typeof taskResponse>;

export const listTasksDto = describeRoute({
	description: "List active tasks",
	tags: ["Tasks"],
	operationId: "listTasks",
	responses: {
		200: {
			description: "List of active tasks",
			content: {
				"application/json": {
					schema: resolver(listTasksResponse),
				},
			},
		},
	},
});

export const getTaskDto = describeRoute({
	description: "Get a task by id",
	tags: ["Tasks"],
	operationId: "getTask",
	responses: {
		200: {
			description: "Task details",
			content: {
				"application/json": {
					schema: resolver(taskResponse),
				},
			},
		},
	},
});

export const streamTaskEventsDto = describeRoute({
	description: "Subscribe to lifecycle events for one task",
	tags: ["Tasks"],
	operationId: "streamTaskEvents",
	responses: {
		200: {
			description: "Task event stream",
			content: {
				"text/event-stream": {
					schema: resolver(taskResponse),
				},
			},
		},
	},
});
