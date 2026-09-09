import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { startMirrorStatus, type GetTaskResponse } from "~/client/api-client";
import { cancelTaskMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { isTaskActive, taskEventsOptions, useActiveTasks, type TaskEventsQuery } from "~/client/hooks/use-active-tasks";
import { useTask } from "~/client/hooks/use-task";
import { parseError } from "~/client/lib/errors";

type MirrorStatusLookup = {
	taskId: string;
	task: GetTaskResponse | null;
};

const isUnsuccessfulLookup = (task: GetTaskResponse | null) => {
	return task !== null && !isTaskActive(task) && task.status !== "succeeded";
};

export const mirrorStatusQueryKey = (scheduleShortId: string, mirrorShortId: string) => {
	return ["mirror-status", scheduleShortId, mirrorShortId] as const;
};

const mirrorStatusOptions = (scheduleShortId: string, mirrorShortId: string) => {
	const queryKey = mirrorStatusQueryKey(scheduleShortId, mirrorShortId);

	return queryOptions({
		queryKey,
		queryFn: async (): Promise<MirrorStatusLookup> => {
			// Keep the request alive after closing so the accepted task ID reaches the cache.
			const { data } = await startMirrorStatus({
				path: { shortId: scheduleShortId, mirrorShortId },
				throwOnError: true,
			});
			return { taskId: data.taskId, task: null };
		},
		staleTime: (query) => {
			const task = query.state.data?.task ?? null;
			if (isUnsuccessfulLookup(task)) return 0;
			return task === null || isTaskActive(task) ? 60 * 60 * 1000 : Infinity;
		},
	});
};

export const useMirrorStatus = (scheduleShortId: string, mirrorShortId: string) => {
	const queryClient = useQueryClient();
	const options = useMemo(
		() => mirrorStatusOptions(scheduleShortId, mirrorShortId),
		[scheduleShortId, mirrorShortId],
	);
	// Refresh on opening or retry, keeping the current snapshot selection stable during invalidations.
	const query = useQuery({ ...options, enabled: false });
	const { mutateAsync: cancelTask, isPending: isCancelling } = useMutation(cancelTaskMutation());
	const cachedTask = query.data?.task ?? null;
	const taskId = query.isFetching ? null : (query.data?.taskId ?? null);
	const streamTaskId = cachedTask && !isTaskActive(cachedTask) ? null : taskId;
	const { task: streamedTask } = useTask(streamTaskId);
	const task = query.isFetching ? null : (streamedTask ?? cachedTask);

	useEffect(() => {
		void queryClient.fetchQuery(options).catch(() => undefined);
	}, [options, queryClient]);

	useEffect(() => {
		if (!streamedTask) return;

		queryClient.setQueryData(options.queryKey, (lookup) => {
			if (!lookup || lookup.taskId !== streamedTask.id) return lookup;

			return { ...lookup, task: streamedTask };
		});
	}, [options.queryKey, queryClient, streamedTask]);

	const isPending = !query.isError && (query.isFetching || task === null || isTaskActive(task));
	const isError = query.isError || isUnsuccessfulLookup(task);
	const error = query.error ? (parseError(query.error)?.message ?? null) : (task?.error ?? null);
	const result = !query.isError && task?.result?.kind === "mirrorStatus" ? task.result : null;
	const status = task?.status ?? null;
	const canCancel = isPending && taskId !== null;
	const cancel = () => {
		if (!taskId) return null;

		return cancelTask({ path: { taskId } });
	};

	return {
		result,
		status,
		isPending,
		isError,
		error,
		canCancel,
		isCancelling,
		retry: query.refetch,
		cancel,
	};
};

const mirrorSyncTasksFilter = (scheduleShortId: string) => {
	return {
		kind: "mirrorSync",
		resourceType: "backup_schedule",
		resourceId: scheduleShortId,
	} satisfies TaskEventsQuery;
};

export const mirrorSyncTasksOptions = (scheduleShortId: string) => {
	return taskEventsOptions(mirrorSyncTasksFilter(scheduleShortId));
};

export const useActiveMirrorSyncTasks = (scheduleShortId: string) => {
	return useActiveTasks(mirrorSyncTasksFilter(scheduleShortId));
};
