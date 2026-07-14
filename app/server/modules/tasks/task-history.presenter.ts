import { taskHistoryKindLabels, type TaskHistoryOutcome } from "~/schemas/task-history";
import type { PersistedTask } from "~/schemas/tasks";
import type { TaskHistoryItem } from "./task-history.dto";

const getTaskHistoryTarget = (task: PersistedTask): TaskHistoryItem["target"] => {
	if (!task.targetDisplayName) {
		return { label: "No target", secondary: null, href: null };
	}

	if (task.resourceType === "backup_schedule" && task.input.kind === "backup") {
		return {
			label: task.targetDisplayName,
			secondary: null,
			href: `/backups/${task.input.scheduleShortId}`,
		};
	}

	if (task.resourceType === "repository" && task.input.kind === "restore") {
		return {
			label: task.input.snapshotId,
			secondary: task.targetDisplayName,
			href: `/repositories/${encodeURIComponent(task.resourceId)}/${encodeURIComponent(task.input.snapshotId)}`,
		};
	}

	if (task.resourceType === "repository") {
		return {
			label: task.targetDisplayName,
			secondary: null,
			href: `/repositories/${encodeURIComponent(task.resourceId)}`,
		};
	}

	return { label: task.targetDisplayName, secondary: null, href: null };
};

const getDoctorIssueMessage = (task: PersistedTask) => {
	if (task.result?.kind !== "doctor") return null;
	if (task.result.lastError) return task.result.lastError;

	return task.result.doctorResult.steps.find((step) => !step.success && step.error)?.error ?? null;
};

const getTaskHistoryMessage = (task: PersistedTask, outcome: TaskHistoryOutcome | null) => {
	if (task.error) {
		return task.error;
	}
	if (outcome === "warning" && task.result?.kind === "backup") {
		return task.result.warningDetails ?? "Backup completed with warnings.";
	}
	if (outcome === "error") {
		return getDoctorIssueMessage(task) ?? "Task failed.";
	}
	if (outcome === "cancelled") {
		return "Task was cancelled.";
	}
	if (outcome === "stale") {
		return "Task stopped reporting before it completed.";
	}

	return null;
};

export const toTaskHistoryItem = (task: PersistedTask): TaskHistoryItem => {
	return {
		id: task.id,
		taskType: taskHistoryKindLabels[task.kind],
		outcome: task.outcome,
		target: getTaskHistoryTarget(task),
		status: task.status,
		createdAt: task.createdAt,
		startedAt: task.startedAt,
		finishedAt: task.finishedAt,
		message: getTaskHistoryMessage(task, task.outcome),
	};
};
