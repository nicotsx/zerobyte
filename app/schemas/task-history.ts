import { z } from "zod";
import { activeTaskStatuses, taskOutcomes, type TaskOutcome, type TaskStatus } from "./tasks";

export const taskHistoryOutcomes = ["running", ...taskOutcomes] as const;
export const taskHistoryOutcomeSchema = z.enum(taskHistoryOutcomes);

export type TaskHistoryOutcome = z.infer<typeof taskHistoryOutcomeSchema>;

export const getTaskHistoryOutcome = (status: TaskStatus, outcome: TaskOutcome | null): TaskHistoryOutcome | null => {
	const isActive = activeTaskStatuses.some((activeStatus) => activeStatus === status);
	if (isActive) {
		return "running";
	}

	return outcome;
};
