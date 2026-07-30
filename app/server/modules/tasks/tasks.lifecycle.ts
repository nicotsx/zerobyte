import { logger } from "@zerobyte/core/node";
import { toMessage } from "~/server/utils/errors";
import type { ParsedTask, TaskResult } from "~/schemas/tasks";
import { taskStore } from "./tasks.store";

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
	try {
		await options.beforeFail?.(errorMessage);
	} catch (error) {
		logger.warn(`Failed to prepare failed ${options.label} ${options.taskId}: ${toMessage(error)}`);
	}

	try {
		return taskStore.fail(options.taskId, errorMessage);
	} catch (error) {
		logger.warn(`Failed to fail ${options.label} ${options.taskId}: ${toMessage(error)}`);
		return null;
	}
};

const cancelTask = async <TResult extends TaskResult>(
	options: TaskLifecycleOptions<TResult>,
	errorMessage: string,
	result: TResult | null,
) => {
	try {
		await options.beforeCancel?.(errorMessage, result);
	} catch (error) {
		logger.warn(`Failed to prepare cancelled ${options.label} ${options.taskId}: ${toMessage(error)}`);
	}

	try {
		return taskStore.cancel(options.taskId, errorMessage, result);
	} catch (error) {
		logger.warn(`Failed to cancel ${options.label} ${options.taskId}: ${toMessage(error)}`);
		return null;
	}
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
		const completedTask = taskStore.complete(options.taskId, result);
		try {
			await options.onSucceeded?.(completedTask, result);
		} catch (error) {
			logger.warn(`Failed to handle successful ${options.label} ${options.taskId}: ${toMessage(error)}`);
		}
	} catch (error) {
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
