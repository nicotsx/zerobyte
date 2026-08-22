import { logger } from "@zerobyte/core/node";
import { toMessage } from "~/server/utils/errors";
import type { ParsedTask, TaskResult } from "~/schemas/tasks";
import { TaskTransitionConflictError, taskStore } from "./tasks.store";

export class TaskCancelledError<TResult extends TaskResult = TaskResult> extends Error {
	readonly name = "TaskCancelledError";
	readonly result: TResult | null;

	constructor(message: string, result: TResult | null = null) {
		super(message);
		this.result = result;
	}
}

export class TaskFailedError extends Error {
	readonly name = "TaskFailedError";
}

type TaskLifecycleOptions<TResult extends TaskResult> = {
	taskId: string;
	label: string;
	cancellable?: boolean;
	prepare?: (signal: AbortSignal) => Promise<() => void>;
	run: (signal: AbortSignal) => Promise<TResult>;
	onStarted?: (task: ParsedTask) => void | Promise<void>;
	onSucceeded?: (task: ParsedTask, result: TResult) => void | Promise<void>;
	beforeFail?: (errorMessage: string) => void | Promise<void>;
	beforeCancel?: (errorMessage: string, result: TResult | null) => void | Promise<void>;
};

const TASK_CANCELLED_ERROR = "Task was cancelled by the user";

type TaskExecution = {
	cancel: () => void;
	cancellable: boolean;
};

const taskExecutions = new Map<string, TaskExecution>();
const deferredTerminalEvent = { emitHistoryChanged: false };

const logTransitionConflict = (label: string, taskId: string, error: TaskTransitionConflictError) => {
	const currentStatus = error.currentTask?.status ?? "missing";
	logger.info(`Stopped ${label} ${taskId}; task is already ${currentStatus}`);
};

export const registerTaskExecution = (taskId: string, cancel: () => void, cancellable: boolean) => {
	const execution = { cancel, cancellable };
	taskExecutions.set(taskId, execution);

	return () => {
		if (taskExecutions.get(taskId) === execution) {
			taskExecutions.delete(taskId);
		}
	};
};

const failTask = async <TResult extends TaskResult>(options: TaskLifecycleOptions<TResult>, errorMessage: string) => {
	let failedTask: ParsedTask;
	try {
		failedTask = taskStore.fail(options.taskId, errorMessage, deferredTerminalEvent);
	} catch (error) {
		if (error instanceof TaskTransitionConflictError) {
			logTransitionConflict(options.label, options.taskId, error);
			return null;
		}

		logger.warn(`Failed to fail ${options.label} ${options.taskId}: ${toMessage(error)}`);
		return null;
	}

	try {
		await options.beforeFail?.(errorMessage);
	} catch (error) {
		logger.warn(`Failed to handle failed ${options.label} ${options.taskId}: ${toMessage(error)}`);
	}

	taskStore.publishHistoryChanged(failedTask);
	return failedTask;
};

const cancelTask = async <TResult extends TaskResult>(
	options: TaskLifecycleOptions<TResult>,
	errorMessage: string,
	result: TResult | null,
) => {
	let cancelledTask: ParsedTask;
	try {
		cancelledTask = taskStore.cancel(options.taskId, errorMessage, result, deferredTerminalEvent);
	} catch (error) {
		if (error instanceof TaskTransitionConflictError) {
			logTransitionConflict(options.label, options.taskId, error);
			return null;
		}

		logger.warn(`Failed to cancel ${options.label} ${options.taskId}: ${toMessage(error)}`);
		return null;
	}

	try {
		await options.beforeCancel?.(errorMessage, result);
	} catch (error) {
		logger.warn(`Failed to handle cancelled ${options.label} ${options.taskId}: ${toMessage(error)}`);
	}

	taskStore.publishHistoryChanged(cancelledTask);
	return cancelledTask;
};

const isTaskCancelledError = (error: unknown): error is TaskCancelledError => {
	return error instanceof TaskCancelledError;
};

const isTaskFailedError = (error: unknown): error is TaskFailedError => {
	return error instanceof TaskFailedError;
};

const isAbortError = (error: unknown) => {
	if (isTaskCancelledError(error)) {
		return true;
	}

	if (error instanceof DOMException && error.name === "AbortError") {
		return true;
	}

	return error instanceof Error && error.name === "AbortError";
};

export const requestTaskCancel = (taskId: string) => {
	const execution = taskExecutions.get(taskId);
	if (execution && !execution.cancellable) {
		return false;
	}

	try {
		taskStore.requestCancel(taskId);
		if (!execution) {
			taskStore.cancel(taskId, TASK_CANCELLED_ERROR);
			return true;
		}
	} catch {
		return false;
	}

	execution.cancel();
	return true;
};

export const runTaskLifecycle = async <TResult extends TaskResult>(options: TaskLifecycleOptions<TResult>) => {
	const abortController = new AbortController();
	const cancellable = options.cancellable === true;
	const cancelExecution = () => abortController.abort(new TaskCancelledError(TASK_CANCELLED_ERROR));
	const unregisterExecution = registerTaskExecution(options.taskId, cancelExecution, cancellable);
	let cleanup: (() => void) | undefined;

	try {
		cleanup = await options.prepare?.(abortController.signal);
		abortController.signal.throwIfAborted();

		const startedTask = taskStore.markRunning(options.taskId);
		await options.onStarted?.(startedTask);

		if (startedTask.cancellationRequested) {
			cancelExecution();
		}

		const result = await options.run(abortController.signal);
		const completedTask = taskStore.complete(options.taskId, result, deferredTerminalEvent);
		try {
			await options.onSucceeded?.(completedTask, result);
		} catch (error) {
			logger.warn(`Failed to handle successful ${options.label} ${options.taskId}: ${toMessage(error)}`);
		}
		taskStore.publishHistoryChanged(completedTask);
	} catch (error) {
		if (error instanceof TaskTransitionConflictError) {
			logTransitionConflict(options.label, options.taskId, error);
			return;
		}

		if (isTaskFailedError(error)) {
			await failTask(options, toMessage(error));
			return;
		}

		if (abortController.signal.aborted || isAbortError(error)) {
			const cancelledError = isTaskCancelledError(error) ? error : null;
			const errorMessage = cancelledError?.message || toMessage(error) || "Task was cancelled";
			const result = (cancelledError?.result as TResult | null) ?? null;
			await cancelTask(options, errorMessage, result);
			return;
		}

		await failTask(options, toMessage(error));
	} finally {
		cleanup?.();
		unregisterExecution();
	}
};
