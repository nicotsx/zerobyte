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
	type TaskResourceType,
	type TaskResult,
} from "~/schemas/tasks";

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
	operationKey?: string | null;
	targetAgentId?: string | null;
	input: TaskInput;
};

type MarkActiveStaleParams = Partial<TaskResource> & { error?: string };
type ListActiveTasksParams = Partial<TaskResource>;
type FindTaskParams = {
	organizationId: string;
	taskId: string;
};
type TaskChangeListener = (task: ParsedTask) => void;

export const RESTART_TASK_ERROR = "Zerobyte was restarted before this task completed";

const parseTask = (row: unknown): ParsedTask => taskSchema.parse(row);

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

const byIdCondition = (id: string) => eq(tasksTable.id, id);

const buildActiveConditions = (params: Partial<TaskResource> = {}) => {
	const conditions: SQL[] = [activeStatusCondition()];

	if (params.organizationId) conditions.push(eq(tasksTable.organizationId, params.organizationId));
	if (params.kind) conditions.push(eq(tasksTable.kind, params.kind));
	if (params.resourceType) conditions.push(eq(tasksTable.resourceType, params.resourceType));
	if (params.resourceId) conditions.push(eq(tasksTable.resourceId, params.resourceId));
	if (params.operationKey) conditions.push(eq(tasksTable.operationKey, params.operationKey));

	return conditions;
};

const getUpdatedTask = (row: unknown, taskId: string, operation: string) => {
	if (!row) {
		throw new Error(`Task ${taskId} was not ${operation}`);
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
				resourceType: params.resourceType,
				resourceId: params.resourceId,
				operationKey: params.operationKey ?? null,
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
		emitTaskChanged(task);
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
		emitTaskChanged(task);
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
		emitTaskChanged(task);
		return task;
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

		const task = getUpdatedTask(row, taskId, "completed");
		emitTaskChanged(task);
		return task;
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

		const task = getUpdatedTask(row, taskId, "failed");
		emitTaskChanged(task);
		return task;
	},

	cancel: (taskId: string, error: string | null = null, result: TaskResult | null = null): ParsedTask => {
		const now = Date.now();
		const row = db
			.update(tasksTable)
			.set({
				status: "cancelled",
				error,
				result: result === null ? null : taskResultSchema.parse(result),
				updatedAt: now,
				finishedAt: now,
			})
			.where(and(byIdCondition(taskId), activeStatusCondition()))
			.returning()
			.get();

		const task = getUpdatedTask(row, taskId, "cancelled");
		emitTaskChanged(task);
		return task;
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
				error: params.error ?? "Task was interrupted before it completed",
				updatedAt: now,
				finishedAt: now,
			})
			.where(and(...buildActiveConditions(params)))
			.returning()
			.all();

		const tasks = rows.map(parseTask);
		for (const task of tasks) {
			emitTaskChanged(task);
		}
		return tasks;
	},
};
