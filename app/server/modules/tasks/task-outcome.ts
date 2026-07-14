import type { TaskOutcome, TaskResult } from "~/schemas/tasks";

export const getCompletedTaskOutcome = (result: TaskResult): TaskOutcome => {
	if (result.kind === "backup" && result.warningDetails !== null) {
		return "warning";
	}

	if (result.kind === "doctor" && (result.repositoryStatus === "error" || !result.doctorResult.success)) {
		return "error";
	}

	return "success";
};
