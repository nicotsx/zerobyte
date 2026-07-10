import { toast } from "sonner";
import {
	taskEventsOptions,
	useActiveTasks,
	type TaskEventsQuery,
	type TaskOfKind,
} from "~/client/hooks/use-active-tasks";

type DoctorTask = TaskOfKind<"doctor">;

const doctorTasksFilter = (repositoryId: string) => {
	return {
		kind: "doctor",
		resourceType: "repository",
		resourceId: repositoryId,
	} satisfies TaskEventsQuery;
};

const applyDoctorTaskFinished = (task: DoctorTask) => {
	if (task.status === "cancelled") {
		toast.info("Doctor cancelled");
		return;
	}

	if (task.status === "failed") {
		toast.error("Doctor failed", {
			description: task.error ?? undefined,
		});
		return;
	}

	const result = task.result;
	if (result?.repositoryStatus === "healthy") {
		toast.success("Doctor completed");
		return;
	}

	toast.error("Doctor found issues", {
		description: result?.lastError ?? task.error ?? undefined,
	});
};

export const doctorTasksOptions = (repositoryId: string) => {
	return taskEventsOptions(doctorTasksFilter(repositoryId));
};

export const useRepositoryDoctorTask = (repositoryId: string) => {
	const doctorTasks = useActiveTasks(doctorTasksFilter(repositoryId), {
		onTaskFinished: applyDoctorTaskFinished,
	});
	const activeDoctorTask = doctorTasks.data?.[0] ?? null;

	return {
		activeDoctorTask,
		isDoctorRunning: activeDoctorTask !== null,
	};
};
