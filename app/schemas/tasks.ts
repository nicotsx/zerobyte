import {
	resticBackupOutputSchema,
	resticBackupProgressSchema,
	resticRestoreOutputSchema,
	restoreProgressSchema,
} from "@zerobyte/core/restic";
import { z } from "zod";

export const taskStatuses = ["queued", "running", "cancelling", "cancelled", "succeeded", "failed", "stale"] as const;
export const activeTaskStatuses = ["queued", "running", "cancelling"] as const;

export const taskStatusSchema = z.enum(taskStatuses);
export const activeTaskStatusSchema = z.enum(activeTaskStatuses);
export const taskKindSchema = z.enum(["backup", "restore", "deleteSnapshots"]);
export const taskResourceTypeSchema = z.enum(["backup_schedule", "repository"]);

export const taskInputSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("backup"),
		scheduleId: z.number(),
		scheduleShortId: z.string(),
		manual: z.boolean(),
	}),
	z.object({
		kind: z.literal("restore"),
		repositoryId: z.string(),
		snapshotId: z.string(),
		target: z.string(),
	}),
	z.object({
		kind: z.literal("deleteSnapshots"),
		repositoryId: z.string(),
		snapshotIds: z.array(z.string()).min(1),
	}),
]);

export const taskProgressSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("backup"),
		progress: resticBackupProgressSchema,
	}),
	z.object({
		kind: z.literal("restore"),
		progress: restoreProgressSchema,
	}),
]);

export const taskResultSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("backup"),
		exitCode: z.number(),
		result: resticBackupOutputSchema.nullable(),
		warningDetails: z.string().nullable(),
	}),
	z.object({
		kind: z.literal("restore"),
		result: resticRestoreOutputSchema,
	}),
	z.object({
		kind: z.literal("deleteSnapshots"),
		deletedSnapshotIds: z.array(z.string()),
	}),
]);

const taskShape = {
	id: z.string(),
	organizationId: z.string(),
	kind: taskKindSchema,
	status: taskStatusSchema,
	resourceType: taskResourceTypeSchema,
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
};

export const taskSchema = z.object(taskShape).superRefine((task, ctx) => {
	if (task.kind !== task.input.kind) {
		ctx.addIssue({
			code: "custom",
			path: ["input", "kind"],
			message: "Task input kind must match task kind",
		});
	}

	if (task.progress && task.kind !== task.progress.kind) {
		ctx.addIssue({
			code: "custom",
			path: ["progress", "kind"],
			message: "Task progress kind must match task kind",
		});
	}

	if (task.result && task.kind !== task.result.kind) {
		ctx.addIssue({
			code: "custom",
			path: ["result", "kind"],
			message: "Task result kind must match task kind",
		});
	}
});
const { organizationId: _organizationId, ...taskDtoShape } = taskShape;

export const taskDtoSchema = z.object(taskDtoShape);

export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type ActiveTaskStatus = z.infer<typeof activeTaskStatusSchema>;
export type TaskKind = z.infer<typeof taskKindSchema>;
export type TaskResourceType = z.infer<typeof taskResourceTypeSchema>;
export type TaskInput = z.infer<typeof taskInputSchema>;
export type TaskProgress = z.infer<typeof taskProgressSchema>;
export type TaskResult = z.infer<typeof taskResultSchema>;
export type ParsedTask = z.infer<typeof taskSchema>;
export type TaskDto = z.infer<typeof taskDtoSchema>;
