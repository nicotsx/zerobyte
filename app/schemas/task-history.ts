import { taskKinds, taskOutcomeSchema, taskOutcomes, type TaskKind, type TaskOutcome } from "./tasks";

export const taskHistoryOutcomes = taskOutcomes;
export const taskHistoryOutcomeSchema = taskOutcomeSchema;

export type TaskHistoryOutcome = TaskOutcome;

export const taskHistoryKindLabels = {
	backup: "Backup",
	restore: "Restore",
	deleteSnapshots: "Delete snapshots",
	tagSnapshots: "Update snapshot tags",
	doctor: "Repository doctor",
} satisfies Record<TaskKind, string>;

export const taskHistoryOutcomeLabels = {
	running: "Running",
	success: "Success",
	warning: "Warning",
	error: "Error",
	cancelled: "Cancelled",
	stale: "Stale",
} satisfies Record<TaskHistoryOutcome, string>;

export const taskHistoryKinds = taskKinds;
