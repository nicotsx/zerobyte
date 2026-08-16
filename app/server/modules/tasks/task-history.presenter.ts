import { getTaskHistoryOutcome, type TaskHistoryLifecycleItem, type TaskHistoryOutcome } from "~/schemas/task-history";
import type { ParsedTask, PersistedTask } from "~/schemas/tasks";
import type { TaskHistoryItem, TaskHistoryTarget } from "./task-history.dto";

const getTaskHistoryTarget = (task: PersistedTask): TaskHistoryTarget => {
	if (
		task.resourceType === "backup_schedule" &&
		(task.input.kind === "backup" || task.input.kind === "mirrorSync" || task.input.kind === "forget")
	) {
		return {
			kind: "backupSchedule",
			label: task.targetDisplayName,
			secondary: null,
			scheduleShortId: task.input.scheduleShortId,
		};
	}

	if (task.resourceType === "repository" && task.input.kind === "restore") {
		return {
			kind: "repository",
			label: task.input.snapshotId,
			secondary: task.targetDisplayName,
			repositoryShortId: task.resourceId,
			snapshotId: task.input.snapshotId,
		};
	}

	if (task.resourceType === "repository") {
		return {
			kind: "repository",
			label: task.targetDisplayName,
			secondary: null,
			repositoryShortId: task.resourceId,
			snapshotId: null,
		};
	}

	return { kind: "unavailable", label: task.targetDisplayName, secondary: null };
};

type TaskHistoryLifecycleSource = Pick<
	ParsedTask,
	"id" | "kind" | "status" | "outcome" | "result" | "error" | "startedAt" | "finishedAt"
>;

const getDoctorIssueMessage = (task: Pick<TaskHistoryLifecycleSource, "result">) => {
	if (task.result?.kind !== "doctor") return null;
	if (task.result.lastError) return task.result.lastError;

	return task.result.doctorResult.steps.find((step) => !step.success && step.error)?.error ?? null;
};

const getTaskHistoryMessage = (
	task: Pick<TaskHistoryLifecycleSource, "error" | "result">,
	outcome: TaskHistoryOutcome | null,
) => {
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

export const toTaskHistoryLifecycleItem = (task: TaskHistoryLifecycleSource): TaskHistoryLifecycleItem => {
	const outcome = getTaskHistoryOutcome(task.status, task.outcome);

	return {
		id: task.id,
		kind: task.kind,
		status: task.status,
		outcome,
		startedAt: task.startedAt,
		finishedAt: task.finishedAt,
		message: getTaskHistoryMessage(task, outcome),
	};
};

export const toTaskHistoryItem = (task: PersistedTask): TaskHistoryItem => {
	const lifecycleItem = toTaskHistoryLifecycleItem(task);

	return {
		...lifecycleItem,
		target: getTaskHistoryTarget(task),
		createdAt: task.createdAt,
	};
};
