import {
	taskEventsOptions,
	useActiveTasks,
	type TaskEventsQuery,
	type TaskOfKind,
} from "~/client/hooks/use-active-tasks";

export type BackupTask = TaskOfKind<"backup">;

const backupTasksFilter = (scheduleShortId?: string) => {
	const filter = { kind: "backup" } satisfies TaskEventsQuery;

	if (scheduleShortId === undefined) return filter;

	return {
		...filter,
		resourceId: scheduleShortId,
		resourceType: "backup_schedule",
	} satisfies TaskEventsQuery;
};

export const backupTasksOptions = (scheduleShortId?: string) => {
	return taskEventsOptions(backupTasksFilter(scheduleShortId));
};

export const useActiveBackupTasks = () => {
	return useActiveTasks(backupTasksFilter());
};

export const useBackupTask = (scheduleShortId: string) => {
	const backupTasks = useActiveTasks(backupTasksFilter(scheduleShortId));
	const activeBackupTask = backupTasks.data[0] ?? null;

	return {
		activeBackupTask,
		backupProgress: activeBackupTask?.progress?.progress ?? null,
		isBackupRunning: activeBackupTask !== null,
	};
};
