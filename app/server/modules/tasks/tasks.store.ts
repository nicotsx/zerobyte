import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "~/server/db/db";
import { tasksTable } from "~/server/db/schema";
import {
	activeTaskStatuses,
	taskInputSchema,
	taskProgressSchema,
	taskResultSchema,
	taskSchema,
	type ParsedTask,
	type TaskInput,
	type TaskKind,
	type TaskProgress,
	type TaskResult,
} from "./tasks.schemas";

type TaskResource = {
	organizationId: string;
	kind: TaskKind;
	resourceType: string;
	resourceId: string;
};

type CreateTaskParams = {
	id?: string;
	organizationId: string;
	resourceType: string;
	resourceId: string;
	targetAgentId?: string | null;
	input: TaskInput;
};

type MarkActiveStaleParams = Partial<TaskResource> & { error?: string };

export const RESTART_TASK_ERROR = "Zerobyte was restarted before this task completed";

const parseTask = (row: unknown): ParsedTask => taskSchema.parse(row);

const activeStatusCondition = () => inArray(tasksTable.status, activeTaskStatuses);

const byIdCondition = (id: string) => eq(tasksTable.id, id);

const buildActiveConditions = (params: Partial<TaskResource> = {}) => {
	const conditions: SQL[] = [activeStatusCondition()];

	if (params.organizationId) conditions.push(eq(tasksTable.organizationId, params.organizationId));
	if (params.kind) conditions.push(eq(tasksTable.kind, params.kind));
	if (params.resourceType) conditions.push(eq(tasksTable.resourceType, params.resourceType));
	if (params.resourceId) conditions.push(eq(tasksTable.resourceId, params.resourceId));

	return conditions;
};

const getUpdatedTask = (row: unknown, taskId: string, operation: string) => {
	if (!row) {
		throw new Error(`Task ${taskId} was not ${operation}`);
	}

	return parseTask(row);
};

export const taskStore = {
	create: (params: CreateTaskParams): ParsedTask => {
		const input = taskInputSchema.parse(params.input);
		const now = Date.now();
		const row = db
			.insert(tasksTable)
			.values({
				id: params.id ?? Bun.randomUUIDv7(),
				organizationId: params.organizationId,
				kind: input.kind,
				status: "queued",
				resourceType: params.resourceType,
				resourceId: params.resourceId,
				targetAgentId: params.targetAgentId ?? null,
				input,
				progress: null,
				result: null,
				error: null,
				cancellationRequested: false,
				createdAt: now,
				updatedAt: now,
			})
			.returning()
			.get();

		return parseTask(row);
	},

	markRunning: (taskId: string): ParsedTask => {
		const now = Date.now();
		const row = db
			.update(tasksTable)
			.set({ status: "running", startedAt: now, updatedAt: now })
			.where(and(byIdCondition(taskId), activeStatusCondition()))
			.returning()
			.get();

		return getUpdatedTask(row, taskId, "marked running");
	},

	updateProgress: (taskId: string, progress: TaskProgress): ParsedTask => {
		const parsedProgress = taskProgressSchema.parse(progress);
		const row = db
			.update(tasksTable)
			.set({ progress: parsedProgress, updatedAt: Date.now() })
			.where(and(byIdCondition(taskId), activeStatusCondition()))
			.returning()
			.get();

		return getUpdatedTask(row, taskId, "updated with progress");
	},

	requestCancel: (taskId: string): ParsedTask => {
		const row = db
			.update(tasksTable)
			.set({ status: "cancelling", cancellationRequested: true, updatedAt: Date.now() })
			.where(and(byIdCondition(taskId), activeStatusCondition()))
			.returning()
			.get();

		return getUpdatedTask(row, taskId, "marked cancelling");
	},

	complete: (taskId: string, result: TaskResult): ParsedTask => {
		const parsedResult = taskResultSchema.parse(result);
		const now = Date.now();
		const row = db
			.update(tasksTable)
			.set({
				status: "succeeded",
				result: parsedResult,
				error: null,
				updatedAt: now,
				finishedAt: now,
			})
			.where(and(byIdCondition(taskId), activeStatusCondition()))
			.returning()
			.get();

		return getUpdatedTask(row, taskId, "completed");
	},

	fail: (taskId: string, error: string): ParsedTask => {
		const now = Date.now();
		const row = db
			.update(tasksTable)
			.set({
				status: "failed",
				error,
				updatedAt: now,
				finishedAt: now,
			})
			.where(and(byIdCondition(taskId), activeStatusCondition()))
			.returning()
			.get();

		return getUpdatedTask(row, taskId, "failed");
	},

	cancel: (taskId: string, error: string | null = null): ParsedTask => {
		const now = Date.now();
		const row = db
			.update(tasksTable)
			.set({
				status: "cancelled",
				error,
				updatedAt: now,
				finishedAt: now,
			})
			.where(and(byIdCondition(taskId), activeStatusCondition()))
			.returning()
			.get();

		return getUpdatedTask(row, taskId, "cancelled");
	},

	findActiveByResource: (params: TaskResource): ParsedTask | null => {
		const rows = db
			.select()
			.from(tasksTable)
			.where(and(...buildActiveConditions(params)))
			.orderBy(desc(tasksTable.createdAt), desc(tasksTable.id))
			.limit(1)
			.all();

		const [row] = rows;
		return row ? parseTask(row) : null;
	},

	listActiveByResource: (params: TaskResource): ParsedTask[] => {
		const rows = db
			.select()
			.from(tasksTable)
			.where(and(...buildActiveConditions(params)))
			.orderBy(desc(tasksTable.createdAt), desc(tasksTable.id))
			.all();

		return rows.map(parseTask);
	},

	markActiveStale: (params: MarkActiveStaleParams = {}): ParsedTask[] => {
		const now = Date.now();
		const rows = db
			.update(tasksTable)
			.set({
				status: "stale",
				error: params.error ?? "Task was interrupted before it completed",
				updatedAt: now,
				finishedAt: now,
			})
			.where(and(...buildActiveConditions(params)))
			.returning()
			.all();

		return rows.map(parseTask);
	},
};
