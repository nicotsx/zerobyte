import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { taskHistoryOutcomeSchema } from "~/schemas/task-history";
import { taskKindSchema, taskStatusSchema } from "~/schemas/tasks";

export const listTaskHistoryQuery = z.object({
	kind: taskKindSchema.optional(),
	outcome: taskHistoryOutcomeSchema.optional(),
	page: z.coerce.number().int().positive().default(1),
});

const taskHistoryTargetSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("backupSchedule"),
		label: z.string(),
		secondary: z.null(),
		scheduleShortId: z.string(),
	}),
	z.object({
		kind: z.literal("repository"),
		label: z.string(),
		secondary: z.string().nullable(),
		repositoryShortId: z.string(),
		snapshotId: z.string().nullable(),
	}),
	z.object({
		kind: z.literal("unavailable"),
		label: z.string(),
		secondary: z.string().nullable(),
	}),
]);

export const taskHistoryItemSchema = z.object({
	id: z.string(),
	kind: taskKindSchema,
	outcome: taskHistoryOutcomeSchema.nullable(),
	target: taskHistoryTargetSchema,
	status: taskStatusSchema,
	createdAt: z.number(),
	startedAt: z.number().nullable(),
	finishedAt: z.number().nullable(),
	message: z.string().nullable(),
});

export const taskHistoryResponseSchema = z.object({
	organizationId: z.string(),
	items: taskHistoryItemSchema.array(),
	page: z.number().int().positive(),
	pageSize: z.number().int().positive(),
	totalItems: z.number().int().nonnegative(),
	totalPages: z.number().int().nonnegative(),
});

export type TaskHistoryItem = z.infer<typeof taskHistoryItemSchema>;
export type TaskHistoryTarget = z.infer<typeof taskHistoryTargetSchema>;
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
