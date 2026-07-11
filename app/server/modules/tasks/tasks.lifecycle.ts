import { logger } from "@zerobyte/core/node";
import { serverEvents } from "~/server/core/events";
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
	run: (signal: AbortSignal) => Promise<TResult>;
	onStarted?: (task: ParsedTask) => void | Promise<void>;
	onSucceeded?: (task: ParsedTask, result: TResult) => void;
	onFailed?: (task: ParsedTask, errorMessage: string) => void;
	onCancelled?: (task: ParsedTask, errorMessage: string, result: TResult | null) => void;
};

const abortControllers = new Map<string, AbortController>();

const emitTaskLifecycleEvent = (eventName: "task:started" | "task:finished", task: ParsedTask) => {
	serverEvents.emit(eventName, {
		organizationId: task.organizationId,
		taskId: task.id,
		kind: task.kind,
		resourceType: task.resourceType,
		resourceId: task.resourceId,
		status: task.status,
	});
};

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
	const abortController = abortControllers.get(taskId);
	if (!abortController) {
		return false;
	}

	try {
		taskStore.requestCancel(taskId);
	} catch {
		return false;
	}

	abortController.abort();
	return true;
};

export const runTaskLifecycle = async <TResult extends TaskResult>(options: TaskLifecycleOptions<TResult>) => {
	const abortController = new AbortController();
	if (options.cancellable) {
		abortControllers.set(options.taskId, abortController);
	}

	try {
		const startedTask = taskStore.markRunning(options.taskId);
		await options.onStarted?.(startedTask);
		emitTaskLifecycleEvent("task:started", startedTask);

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
		emitTaskLifecycleEvent("task:finished", completedTask);
	} catch (error) {
		if (abortController.signal.aborted || isAbortError(error)) {
			const cancelledError = isTaskCancelledError(error) ? error : null;
			const errorMessage = cancelledError?.message || toMessage(error) || "Task was cancelled";
			const result = (cancelledError?.result as TResult | null) ?? null;
			const cancelledTask = cancelTask(options, errorMessage, result);
			if (cancelledTask) {
				emitTaskLifecycleEvent("task:finished", cancelledTask);
			}
			return;
		}

		const failedTask = failTask(options, toMessage(error));
		if (failedTask) {
			emitTaskLifecycleEvent("task:finished", failedTask);
		}
	} finally {
		if (options.cancellable) {
			abortControllers.delete(options.taskId);
		}
	}
};
