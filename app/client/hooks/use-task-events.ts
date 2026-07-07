import { useEffect, useState } from "react";
import { logger } from "~/client/lib/logger";
import { taskChangedEventName } from "~/schemas/task-events";
import type { TaskDto } from "~/schemas/tasks";

type UseTaskEventsOptions = {
	enabled?: boolean;
};

const parseTaskEvent = (event: Event): TaskDto => {
	return JSON.parse((event as MessageEvent<string>).data) as TaskDto;
};

export const useTaskEvents = (taskId: string | null | undefined, options: UseTaskEventsOptions = {}) => {
	const enabled = options.enabled ?? true;
	const [task, setTask] = useState<TaskDto | null>(null);

	useEffect(() => {
		if (!enabled || !taskId) {
			setTask(null);
			return;
		}

		setTask(null);
		const eventSource = new EventSource(`/api/v1/tasks/${taskId}/events`);
		const updateTask = (event: Event) => {
			const nextTask = parseTaskEvent(event);
			setTask((currentTask) => {
				const shouldReplace = !currentTask || nextTask.updatedAt >= currentTask.updatedAt;
				if (!shouldReplace) return currentTask;
				return nextTask;
			});
		};

		eventSource.addEventListener(taskChangedEventName, updateTask);
		eventSource.onerror = (error) => {
			logger.error(`[SSE] Task ${taskId} connection error:`, error);
		};

		return () => {
			eventSource.close();
		};
	}, [enabled, taskId]);

	return { task };
};
