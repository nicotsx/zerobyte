import { z } from "zod";
import { describeRoute, resolver } from "hono-openapi";
import {
	taskInputSchema,
	taskKindSchema,
	taskProgressSchema,
	taskResultSchema,
	taskStatusSchema,
} from "./tasks.schemas";

export const listTasksQuery = z.object({
	kind: taskKindSchema.optional(),
});

export const taskResponse = z.object({
	id: z.string(),
	kind: taskKindSchema,
	status: taskStatusSchema,
	resourceType: z.string(),
	resourceId: z.string(),
	targetAgentId: z.string().nullable(),
	input: taskInputSchema,
	progress: taskProgressSchema.nullable(),
	result: taskResultSchema.nullable(),
	error: z.string().nullable(),
	cancellationRequested: z.boolean(),
	createdAt: z.number(),
	startedAt: z.number().nullable(),
	updatedAt: z.number(),
	finishedAt: z.number().nullable(),
});
export type TaskDto = z.infer<typeof taskResponse>;

const listTasksResponse = taskResponse.array();
export type ListTasksDto = z.infer<typeof listTasksResponse>;

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
