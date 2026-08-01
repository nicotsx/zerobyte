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

type TaskLifecycleOptions<TResult extends TaskResult> = {
	taskId: string;
	label: string;
	cancellable?: boolean;
	prepare?: (signal: AbortSignal) => Promise<() => void>;
	run: (signal: AbortSignal) => Promise<TResult>;
	onStarted?: (task: ParsedTask) => void | Promise<void>;
	onSucceeded?: (task: ParsedTask, result: TResult) => void;
	onFailed?: (task: ParsedTask, errorMessage: string) => void;
	onCancelled?: (task: ParsedTask, errorMessage: string, result: TResult | null) => void;
};

type TaskExecution = {
	abortController: AbortController;
	cancellable: boolean;
};

const taskExecutions = new Map<string, TaskExecution>();

const failTask = <TResult extends TaskResult>(options: TaskLifecycleOptions<TResult>, errorMessage: string) => {
	try {
		const failedTask = taskStore.fail(options.taskId, errorMessage);
		options.onFailed?.(failedTask, errorMessage);
		return failedTask;
	} catch (error) {
		logger.warn(`Failed to fail ${options.label} ${options.taskId}: ${toMessage(error)}`);
		return null;
	}
};

const cancelTask = <TResult extends TaskResult>(
	options: TaskLifecycleOptions<TResult>,
	errorMessage: string,
	result: TResult | null,
) => {
	try {
		const cancelledTask = taskStore.cancel(options.taskId, errorMessage, result);
		options.onCancelled?.(cancelledTask, errorMessage, result);
		return cancelledTask;
	} catch (error) {
		logger.warn(`Failed to cancel ${options.label} ${options.taskId}: ${toMessage(error)}`);
		return null;
	}
};

const isTaskCancelledError = (error: unknown): error is TaskCancelledError => {
	return error instanceof TaskCancelledError;
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
			taskStore.cancel(taskId, "Task was cancelled by the user");
			return true;
		}
	} catch {
		return false;
	}

	execution.abortController.abort();
	return true;
};

export const runTaskLifecycle = async <TResult extends TaskResult>(options: TaskLifecycleOptions<TResult>) => {
	const abortController = new AbortController();
	const execution = { abortController, cancellable: options.cancellable === true };
	let cleanup: (() => void) | undefined;
	taskExecutions.set(options.taskId, execution);

	try {
		cleanup = await options.prepare?.(abortController.signal);
		abortController.signal.throwIfAborted();

		const startedTask = taskStore.markRunning(options.taskId);
		await options.onStarted?.(startedTask);

		if (startedTask.cancellationRequested) {
			abortController.abort();
		}

		const result = await options.run(abortController.signal);
		const completedTask = taskStore.complete(options.taskId, result);
		try {
			options.onSucceeded?.(completedTask, result);
		} catch (error) {
			logger.warn(`Failed to handle successful ${options.label} ${options.taskId}: ${toMessage(error)}`);
		}
	} catch (error) {
		if (abortController.signal.aborted || isAbortError(error)) {
			const cancelledError = isTaskCancelledError(error) ? error : null;
			const errorMessage = cancelledError?.message || toMessage(error) || "Task was cancelled";
			const result = (cancelledError?.result as TResult | null) ?? null;
			cancelTask(options, errorMessage, result);
			return;
		}

		failTask(options, toMessage(error));
	} finally {
		cleanup?.();
		if (taskExecutions.get(options.taskId) === execution) {
			taskExecutions.delete(options.taskId);
		}
	}
};
