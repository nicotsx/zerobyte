import { and, desc, eq, inArray, lt, sql, type SQL } from "drizzle-orm";
import { db } from "~/server/db/db";
import { tasksTable } from "~/server/db/schema";
import type { TaskHistoryOutcome } from "~/schemas/task-history";
import {
	activeTaskStatuses,
	finishedTaskStatuses,
	finishedTaskStatusSchema,
	taskInputSchema,
	TASK_PERSISTENCE_FORMAT_VERSION,
	taskProgressSchema,
	taskResultSchema,
	taskSchema,
	type ParsedTask,
	type FinishedTaskStatus,
	type TaskInput,
	type TaskKind,
	type TaskProgress,
	type TaskResourceType,
	type TaskResult,
} from "~/schemas/tasks";
import { serverEvents } from "~/server/core/events";
import { toTaskHistoryLifecycleItem } from "./task-history.presenter";
import { getCompletedTaskOutcome } from "./task-outcome";

type TaskResource = {
	organizationId: string;
	kind: TaskKind;
	resourceType: TaskResourceType;
	resourceId: string;
	operationKey?: string;
};

type CreateTaskParams = {
	id?: string;
	organizationId: string;
	resourceType: TaskResourceType;
	resourceId: string;
	targetDisplayName: string;
	operationKey?: string | null;
	targetAgentId?: string | null;
	input: TaskInput;
};

type MarkActiveStaleParams = Partial<TaskResource> & { error?: string; createdBefore?: number };
type TerminalTaskOptions = { emitHistoryChanged?: boolean };
type ListActiveTasksParams = Partial<TaskResource>;
type FindTaskParams = {
	organizationId: string;
	taskId: string;
};
type TaskChangeListener = (task: ParsedTask) => void;

export const RESTART_TASK_ERROR = "Zerobyte was restarted before this task completed";

export class TaskTransitionConflictError extends Error {
	readonly currentTask: ParsedTask | null;

	constructor(taskId: string, operation: string, currentTask: ParsedTask | null) {
		const currentStatus = currentTask?.status ?? "missing";
		super(`Task ${taskId} was not ${operation}; current status is ${currentStatus}`);
		this.name = "TaskTransitionConflictError";
		this.currentTask = currentTask;
	}
}

const parseTask = (row: unknown): ParsedTask => taskSchema.parse(row);

type FinishedTask = Omit<ParsedTask, "status" | "finishedAt"> & {
	status: FinishedTaskStatus;
	finishedAt: number;
};

const parseFinishedTask = (row: unknown): FinishedTask => {
	const task = parseTask(row);
	const status = finishedTaskStatusSchema.parse(task.status);
	if (task.finishedAt === null) {
		throw new Error(`Finished task ${task.id} has no completion time`);
	}

	return { ...task, status, finishedAt: task.finishedAt };
};

const taskListeners = new Map<string, Set<TaskChangeListener>>();
const allTaskListeners = new Set<TaskChangeListener>();

const emitTaskChanged = (task: ParsedTask) => {
	const listeners = taskListeners.get(task.id);
	if (listeners) {
		for (const listener of listeners) {
			listener(task);
		}
	}

	for (const listener of allTaskListeners) {
		listener(task);
	}
};

const emitTaskHistoryChanged = (task: ParsedTask, previousOutcome: TaskHistoryOutcome | null = null) => {
	emitTaskChanged(task);
	const item = toTaskHistoryLifecycleItem(task);

	serverEvents.emit("task:history-changed", {
		organizationId: task.organizationId,
		previousOutcome,
		item,
	});
};

const subscribeToAllTaskChanges = (listener: TaskChangeListener) => {
	allTaskListeners.add(listener);

	return () => {
		allTaskListeners.delete(listener);
	};
};

const subscribeToTaskChanges = (taskId: string, listener: TaskChangeListener) => {
	let listeners = taskListeners.get(taskId);
	if (!listeners) {
		listeners = new Set();
		taskListeners.set(taskId, listeners);
	}

	listeners.add(listener);

	return () => {
		const currentListeners = taskListeners.get(taskId);
		if (!currentListeners) {
			return;
		}

		currentListeners.delete(listener);
		if (currentListeners.size === 0) {
			taskListeners.delete(taskId);
		}
	};
};

const taskMatchesFilter = (task: ParsedTask, filter: Partial<TaskResource>) => {
	if (filter.organizationId && task.organizationId !== filter.organizationId) return false;
	if (filter.kind && task.kind !== filter.kind) return false;
	if (filter.resourceType && task.resourceType !== filter.resourceType) return false;
	if (filter.resourceId && task.resourceId !== filter.resourceId) return false;
	if (filter.operationKey && task.operationKey !== filter.operationKey) return false;

	return true;
};

const activeStatusCondition = () => inArray(tasksTable.status, activeTaskStatuses);
const finishedStatusCondition = () => inArray(tasksTable.status, finishedTaskStatuses);

const byIdCondition = (id: string) => eq(tasksTable.id, id);

const buildResourceConditions = (params: Partial<TaskResource> = {}) => {
	const conditions: SQL[] = [];
	if (params.organizationId) conditions.push(eq(tasksTable.organizationId, params.organizationId));
	if (params.kind) conditions.push(eq(tasksTable.kind, params.kind));
	if (params.resourceType) conditions.push(eq(tasksTable.resourceType, params.resourceType));
	if (params.resourceId) conditions.push(eq(tasksTable.resourceId, params.resourceId));
	if (params.operationKey) conditions.push(eq(tasksTable.operationKey, params.operationKey));

	return conditions;
};

const buildActiveConditions = (params: Partial<TaskResource> = {}) => [
	activeStatusCondition(),
	...buildResourceConditions(params),
];

const buildStaleTaskConditions = (params: MarkActiveStaleParams) => {
	const conditions = buildActiveConditions(params);
	if (params.createdBefore !== undefined) {
		conditions.push(lt(tasksTable.createdAt, params.createdBefore));
	}

	return conditions;
};

const findTaskById = (taskId: string): ParsedTask | null => {
	const row = db.select().from(tasksTable).where(byIdCondition(taskId)).get();
	return row ? parseTask(row) : null;
};

const getUpdatedTask = (row: unknown, taskId: string, operation: string) => {
	if (!row) {
		const currentTask = findTaskById(taskId);
		throw new TaskTransitionConflictError(taskId, operation, currentTask);
	}

	return parseTask(row);
};

const listActiveTasks = (params: ListActiveTasksParams = {}): ParsedTask[] => {
	const activeConditions = buildActiveConditions(params);
	const rows = db
		.select()
		.from(tasksTable)
		.where(and(...activeConditions))
		.orderBy(desc(tasksTable.createdAt), desc(tasksTable.id))
		.all();

	return rows.map(parseTask);
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
				outcome: null,
				resourceType: params.resourceType,
				resourceId: params.resourceId,
				operationKey: params.operationKey ?? null,
				persistenceFormatVersion: TASK_PERSISTENCE_FORMAT_VERSION,
				targetDisplayName: params.targetDisplayName,
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

		const task = parseTask(row);
		emitTaskHistoryChanged(task);
		return task;
	},

	markRunning: (taskId: string): ParsedTask => {
		const now = Date.now();
		const row = db
			.update(tasksTable)
			.set({ status: "running", startedAt: now, updatedAt: now })
			.where(and(byIdCondition(taskId), activeStatusCondition()))
			.returning()
			.get();

		const task = getUpdatedTask(row, taskId, "marked running");
		emitTaskHistoryChanged(task, "running");
		return task;
	},

	updateProgress: (taskId: string, progress: TaskProgress): ParsedTask => {
		const parsedProgress = taskProgressSchema.parse(progress);
		const row = db
			.update(tasksTable)
			.set({ progress: parsedProgress, updatedAt: Date.now() })
			.where(and(byIdCondition(taskId), activeStatusCondition()))
			.returning()
			.get();

		const task = getUpdatedTask(row, taskId, "updated with progress");
		emitTaskChanged(task);
		return task;
	},

	requestCancel: (taskId: string): ParsedTask => {
		const row = db
			.update(tasksTable)
			.set({ status: "cancelling", cancellationRequested: true, updatedAt: Date.now() })
			.where(and(byIdCondition(taskId), activeStatusCondition()))
			.returning()
			.get();

		const task = getUpdatedTask(row, taskId, "marked cancelling");
		emitTaskHistoryChanged(task, "running");
		return task;
	},

	complete: (taskId: string, result: TaskResult, options: TerminalTaskOptions = {}): ParsedTask => {
		const parsedResult = taskResultSchema.parse(result);
		const shouldEmitHistoryChanged = options.emitHistoryChanged ?? true;
		const now = Date.now();
		const row = db
			.update(tasksTable)
			.set({
				status: "succeeded",
				outcome: getCompletedTaskOutcome(parsedResult),
				result: parsedResult,
				error: null,
				updatedAt: now,
				finishedAt: now,
			})
			.where(and(byIdCondition(taskId), activeStatusCondition()))
			.returning()
			.get();

		const task = getUpdatedTask(row, taskId, "completed");
		if (shouldEmitHistoryChanged) {
			emitTaskHistoryChanged(task, "running");
		}
		return task;
	},

	fail: (taskId: string, error: string, options: TerminalTaskOptions = {}): ParsedTask => {
		const shouldEmitHistoryChanged = options.emitHistoryChanged ?? true;
		const now = Date.now();
		const row = db
			.update(tasksTable)
			.set({
				status: "failed",
				outcome: "error",
				error,
				updatedAt: now,
				finishedAt: now,
			})
			.where(and(byIdCondition(taskId), activeStatusCondition()))
			.returning()
			.get();

		const task = getUpdatedTask(row, taskId, "failed");
		if (shouldEmitHistoryChanged) {
			emitTaskHistoryChanged(task, "running");
		}
		return task;
	},

	cancel: (
		taskId: string,
		error: string | null = null,
		result: TaskResult | null = null,
		options: TerminalTaskOptions = {},
	): ParsedTask => {
		const shouldEmitHistoryChanged = options.emitHistoryChanged ?? true;
		const now = Date.now();
		const row = db
			.update(tasksTable)
			.set({
				status: "cancelled",
				outcome: "cancelled",
				error,
				result: result === null ? null : taskResultSchema.parse(result),
				updatedAt: now,
				finishedAt: now,
			})
			.where(and(byIdCondition(taskId), activeStatusCondition()))
			.returning()
			.get();

		const task = getUpdatedTask(row, taskId, "cancelled");
		if (shouldEmitHistoryChanged) {
			emitTaskHistoryChanged(task, "running");
		}
		return task;
	},

	publishHistoryChanged: (task: ParsedTask) => {
		emitTaskHistoryChanged(task, "running");
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

	findQueuedByResource: (params: TaskResource): ParsedTask | null => {
		const resourceConditions = buildResourceConditions(params);
		const row = db
			.select()
			.from(tasksTable)
			.where(and(eq(tasksTable.status, "queued"), ...resourceConditions))
			.orderBy(desc(tasksTable.createdAt), desc(tasksTable.id))
			.limit(1)
			.get();

		return row ? parseTask(row) : null;
	},

	updateQueuedInput: (taskId: string, input: TaskInput): ParsedTask | null => {
		const parsedInput = taskInputSchema.parse(input);
		const row = db
			.update(tasksTable)
			.set({ input: parsedInput, updatedAt: Date.now() })
			.where(and(byIdCondition(taskId), eq(tasksTable.status, "queued")))
			.returning()
			.get();

		if (!row) {
			return null;
		}

		const task = parseTask(row);
		emitTaskChanged(task);
		return task;
	},

	findLatestFinishedByResources: (
		params: Omit<TaskResource, "operationKey">,
		operationKeys: string[],
	): FinishedTask[] => {
		if (operationKeys.length === 0) {
			return [];
		}

		const resourceConditions = buildResourceConditions(params);
		const rankedTaskIds = db
			.select({
				id: tasksTable.id,
				rank: sql<number>`row_number() over (
					partition by ${tasksTable.operationKey}
					order by ${tasksTable.finishedAt} desc, ${tasksTable.createdAt} desc, ${tasksTable.id} desc
				)`.as("task_rank"),
			})
			.from(tasksTable)
			.where(
				and(finishedStatusCondition(), ...resourceConditions, inArray(tasksTable.operationKey, operationKeys)),
			)
			.as("ranked_task_ids");
		const rows = db
			.select({ task: tasksTable })
			.from(tasksTable)
			.innerJoin(rankedTaskIds, and(eq(tasksTable.id, rankedTaskIds.id), eq(rankedTaskIds.rank, 1)))
			.all();

		return rows.map((row) => parseFinishedTask(row.task));
	},

	listActive: (params: ListActiveTasksParams = {}): ParsedTask[] => {
		return listActiveTasks(params);
	},

	subscribeToChanges: (taskId: string, listener: TaskChangeListener) => {
		return subscribeToTaskChanges(taskId, listener);
	},

	subscribeToAllChanges: (filter: ListActiveTasksParams, listener: TaskChangeListener) => {
		return subscribeToAllTaskChanges((task) => {
			if (taskMatchesFilter(task, filter)) {
				listener(task);
			}
		});
	},

	findById: (params: FindTaskParams): ParsedTask | null => {
		const row = db
			.select()
			.from(tasksTable)
			.where(and(byIdCondition(params.taskId), eq(tasksTable.organizationId, params.organizationId)))
			.get();

		return row ? parseTask(row) : null;
	},

	markActiveStale: (params: MarkActiveStaleParams = {}): ParsedTask[] => {
		const now = Date.now();
		const rows = db
			.update(tasksTable)
			.set({
				status: "stale",
				outcome: "stale",
				error: params.error ?? "Task was interrupted before it completed",
				updatedAt: now,
				finishedAt: now,
			})
			.where(and(...buildStaleTaskConditions(params)))
			.returning()
			.all();

		const tasks = rows.map(parseTask);
		for (const task of tasks) {
			emitTaskHistoryChanged(task, "running");
		}
		return tasks;
	},
};
