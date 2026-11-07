import type { QueryClient } from "@tanstack/react-query";
import { getTaskOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { logger } from "~/client/lib/logger";
import { activeTasksOptions, isTaskActive } from "~/client/queries/active-tasks";
import { taskChangedEventName, tasksSnapshotEventName } from "~/schemas/task-events";
import { taskDtoSchema, type TaskDto } from "~/schemas/tasks";

type TaskEventSubscriber = {
	onSnapshot: (tasks: TaskDto[]) => void;
	onTaskChanged: (task: TaskDto) => void;
};

type TaskEventStream = {
	eventSource: EventSource;
	subscribers: Set<TaskEventSubscriber>;
	finishedTasks: Map<string, number>;
	hasSnapshot: boolean;
};

const streams = new WeakMap<QueryClient, TaskEventStream>();
const taskQueryKey = activeTasksOptions().queryKey;

const deliver = (callback: () => void) => {
	try {
		callback();
	} catch (error) {
		logger.error("[SSE] Task event callback failed:", error);
	}
};

const connect = (queryClient: QueryClient): TaskEventStream => {
	const eventSource = new EventSource("/api/v1/tasks/events");
	const stream: TaskEventStream = {
		eventSource,
		subscribers: new Set(),
		finishedTasks: new Map(),
		hasSnapshot: false,
	};
	streams.set(queryClient, stream);

	const hasFinished = (task: TaskDto) => {
		const finishedAt = stream.finishedTasks.get(task.id);
		return finishedAt !== undefined && finishedAt >= task.updatedAt;
	};

	const handleTaskChanged = (task: TaskDto) => {
		if (streams.get(queryClient) !== stream || hasFinished(task)) return;

		const tasks = queryClient.getQueryData(taskQueryKey) ?? [];
		const previous = tasks.find((entry) => entry.id === task.id);
		if (previous && previous.updatedAt > task.updatedAt) return;

		let nextTasks: TaskDto[];
		if (!isTaskActive(task)) {
			stream.finishedTasks.set(task.id, task.updatedAt);
			nextTasks = tasks.filter((entry) => entry.id !== task.id);
		} else if (previous) {
			nextTasks = tasks.map((entry) => (entry.id === task.id ? task : entry));
		} else {
			nextTasks = [task, ...tasks];
		}

		queryClient.setQueryData(taskQueryKey, nextTasks);

		for (const subscriber of stream.subscribers) {
			deliver(() => subscriber.onTaskChanged(task));
		}
	};

	const reconcileMissingTask = async (missingTask: TaskDto) => {
		const response = await queryClient.fetchQuery(getTaskOptions({ path: { taskId: missingTask.id } }));
		const task = taskDtoSchema.parse(response);
		if (isTaskActive(task) || task.updatedAt < missingTask.updatedAt) return;

		handleTaskChanged(task);
	};

	eventSource.addEventListener(tasksSnapshotEventName, (event) => {
		const tasks = taskDtoSchema.array().parse(JSON.parse((event as MessageEvent<string>).data));
		const previousTasks = queryClient.getQueryData(taskQueryKey) ?? [];
		const snapshot = tasks.filter((task) => !hasFinished(task));
		const snapshotIds = new Set(snapshot.map((task) => task.id));
		stream.hasSnapshot = true;

		queryClient.setQueryData(taskQueryKey, snapshot);

		for (const subscriber of stream.subscribers) {
			deliver(() => subscriber.onSnapshot(snapshot));
		}

		for (const task of previousTasks) {
			if (snapshotIds.has(task.id)) continue;

			void reconcileMissingTask(task).catch((error: unknown) => {
				logger.error("[SSE] Failed to reconcile missing task:", error);
			});
		}
	});

	eventSource.addEventListener(taskChangedEventName, (event) => {
		const task = taskDtoSchema.parse(JSON.parse((event as MessageEvent<string>).data));
		handleTaskChanged(task);
	});

	eventSource.onerror = (error) => {
		stream.hasSnapshot = false;
		logger.error("[SSE] Task stream connection error:", error);
	};

	return stream;
};

export const subscribeToTaskEvents = (queryClient: QueryClient, subscriber: TaskEventSubscriber) => {
	const stream = streams.get(queryClient) ?? connect(queryClient);
	stream.subscribers.add(subscriber);

	if (stream.hasSnapshot) {
		const tasks = queryClient.getQueryData(taskQueryKey) ?? [];
		deliver(() => subscriber.onSnapshot(tasks));
	}

	return () => {
		if (!stream.subscribers.delete(subscriber)) return;
		if (stream.subscribers.size > 0) return;

		stream.eventSource.close();
		streams.delete(queryClient);
	};
};
