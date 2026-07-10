import { useEffect, useState } from "react";
import type { GetTaskResponse } from "~/client/api-client";
import { logger } from "~/client/lib/logger";
import { taskChangedEventName } from "~/schemas/task-events";

type StreamedTask<T extends GetTaskResponse> = {
	taskId: string;
	task: T;
};

const parseTaskEvent = <T extends GetTaskResponse>(event: Event): T => {
	return JSON.parse((event as MessageEvent<string>).data) as T;
};

export const useTask = <T extends GetTaskResponse = GetTaskResponse>(taskId: string | null | undefined) => {
	const [streamedTask, setStreamedTask] = useState<StreamedTask<T> | null>(null);

	useEffect(() => {
		if (!taskId) return;

		let isCurrent = true;
		const eventSource = new EventSource(`/api/v1/tasks/${taskId}/events`);
		const updateTask = (event: Event) => {
			const nextTask = parseTaskEvent<T>(event);
			if (!isCurrent || nextTask.id !== taskId) return;

			setStreamedTask((current) => {
				if (current?.taskId === taskId && nextTask.updatedAt < current.task.updatedAt) {
					return current;
				}

				return { taskId, task: nextTask };
			});
		};

		eventSource.addEventListener(taskChangedEventName, updateTask);
		eventSource.onerror = (error) => {
			logger.error(`[SSE] Task ${taskId} connection error:`, error);
		};

		return () => {
			isCurrent = false;
			eventSource.close();
		};
	}, [taskId]);

	return {
		task: streamedTask && streamedTask.taskId === taskId ? streamedTask.task : null,
	};
};
