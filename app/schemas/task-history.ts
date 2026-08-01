import { z } from "zod";
import { activeTaskStatuses, taskOutcomes, type TaskKind, type TaskOutcome, type TaskStatus } from "./tasks";

export const taskHistoryOutcomes = ["running", ...taskOutcomes] as const;
export const taskHistoryOutcomeSchema = z.enum(taskHistoryOutcomes);

export type TaskHistoryOutcome = z.infer<typeof taskHistoryOutcomeSchema>;

export type TaskHistoryLifecycleItem = {
	id: string;
	kind: TaskKind;
	status: TaskStatus;
	outcome: TaskHistoryOutcome | null;
	startedAt: number | null;
	finishedAt: number | null;
	message: string | null;
};

export const getTaskHistoryOutcome = (status: TaskStatus, outcome: TaskOutcome | null): TaskHistoryOutcome | null => {
	const isActive = activeTaskStatuses.some((activeStatus) => activeStatus === status);
	if (isActive) {
		return "running";
	}

	return outcome;
};
