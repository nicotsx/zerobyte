import { z } from "zod";
import { describeRoute, resolver } from "hono-openapi";
import { taskDtoSchema, taskKindSchema, taskResourceTypeSchema } from "~/schemas/tasks";

export const listTasksQuery = z
	.object({
		kind: taskKindSchema.optional(),
		resourceType: taskResourceTypeSchema.optional(),
		resourceId: z.string().optional(),
		operationKey: z.string().optional(),
	})
	.superRefine((query, ctx) => {
		const hasResourceType = Boolean(query.resourceType);
		const hasResourceId = Boolean(query.resourceId);
		if (hasResourceType === hasResourceId) {
			return;
		}

		const issuePath = hasResourceType ? ["resourceId"] : ["resourceType"];
		ctx.addIssue({
			code: "custom",
			path: issuePath,
			message: "resourceType and resourceId must be provided together",
		});
	});

export const taskResponse = taskDtoSchema;
export type TaskDto = z.infer<typeof taskResponse>;

const listTasksResponse = taskResponse.array();
const taskStreamResponse = z.union([taskResponse, listTasksResponse]);
export type ListTasksDto = z.infer<typeof listTasksResponse>;

export type GetTaskDto = z.infer<typeof taskResponse>;

const cancelTaskResponse = z.object({
	status: z.literal("cancelling"),
});

export type CancelTaskDto = z.infer<typeof cancelTaskResponse>;

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

export const cancelTaskDto = describeRoute({
	description: "Request cancellation of a running task",
	tags: ["Tasks"],
	operationId: "cancelTask",
	responses: {
		202: {
			description: "Task cancellation requested",
			content: {
				"application/json": {
					schema: resolver(cancelTaskResponse),
				},
			},
		},
		409: {
			description: "Task is not cancellable or is no longer running",
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

export const streamTasksEventsDto = describeRoute({
	description: "Subscribe to lifecycle events for active tasks matching a filter",
	tags: ["Tasks"],
	operationId: "streamTasksEvents",
	responses: {
		200: {
			description: "Filtered task event stream",
			content: {
				"text/event-stream": {
					schema: resolver(taskStreamResponse),
				},
			},
		},
	},
});
