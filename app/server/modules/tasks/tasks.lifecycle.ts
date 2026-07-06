import { logger } from "@zerobyte/core/node";
import { toMessage } from "~/server/utils/errors";
import type { ParsedTask, TaskResult } from "./tasks.schemas";
import { taskStore } from "./tasks.store";

type TaskLifecycleOptions<TResult extends TaskResult> = {
	taskId: string;
	label: string;
	run: () => Promise<TResult>;
	onStarted?: (task: ParsedTask) => void;
	onSucceeded?: (task: ParsedTask, result: TResult) => void;
	onFailed?: (task: ParsedTask, errorMessage: string) => void;
};

const failTask = <TResult extends TaskResult>(options: TaskLifecycleOptions<TResult>, errorMessage: string) => {
	try {
		const failedTask = taskStore.fail(options.taskId, errorMessage);
		options.onFailed?.(failedTask, errorMessage);
	} catch (error) {
		logger.warn(`Failed to fail ${options.label} ${options.taskId}: ${toMessage(error)}`);
	}
};

export const runTaskLifecycle = async <TResult extends TaskResult>(options: TaskLifecycleOptions<TResult>) => {
	try {
		const startedTask = taskStore.markRunning(options.taskId);
		options.onStarted?.(startedTask);
		const result = await options.run();
		const completedTask = taskStore.complete(options.taskId, result);
		options.onSucceeded?.(completedTask, result);
	} catch (error) {
		const errorMessage = toMessage(error);
		failTask(options, errorMessage);
	}
};
