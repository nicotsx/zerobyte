import { taskEventsOptions, useActiveTasks, type TaskEventsQuery } from "~/client/hooks/use-active-tasks";

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
