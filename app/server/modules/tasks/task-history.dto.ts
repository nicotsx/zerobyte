import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { taskHistoryOutcomeSchema } from "~/schemas/task-history";
import { taskKindSchema, taskStatusSchema } from "~/schemas/tasks";

export const listTaskHistoryQuery = z.object({
	kind: taskKindSchema.optional(),
	outcome: taskHistoryOutcomeSchema.optional(),
	page: z.coerce.number().int().positive().default(1),
});

const taskHistoryTargetSchema = z.object({
	label: z.string(),
	secondary: z.string().nullable(),
	href: z.string().nullable(),
});

export const taskHistoryItemSchema = z.object({
	id: z.string(),
	taskType: z.string(),
	outcome: taskHistoryOutcomeSchema.nullable(),
	target: taskHistoryTargetSchema,
	status: taskStatusSchema,
	createdAt: z.number(),
	startedAt: z.number().nullable(),
	finishedAt: z.number().nullable(),
	message: z.string().nullable(),
});

export const taskHistoryResponseSchema = z.object({
	items: taskHistoryItemSchema.array(),
	page: z.number().int().positive(),
	pageSize: z.number().int().positive(),
	totalItems: z.number().int().nonnegative(),
	totalPages: z.number().int().nonnegative(),
});

export type TaskHistoryItem = z.infer<typeof taskHistoryItemSchema>;
export type TaskHistoryResponse = z.infer<typeof taskHistoryResponseSchema>;

export const listTaskHistoryDto = describeRoute({
	description: "List persisted task history for the current organization",
	tags: ["Tasks"],
	operationId: "listTaskHistory",
	responses: {
		200: {
			description: "A page of task history",
			content: {
				"application/json": {
					schema: resolver(taskHistoryResponseSchema),
				},
			},
		},
	},
});
