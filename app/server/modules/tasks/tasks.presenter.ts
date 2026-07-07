import type { ParsedTask, TaskDto } from "~/schemas/tasks";

export const toTaskDto = (task: ParsedTask): TaskDto => {
	const { organizationId: _organizationId, ...taskDto } = task;
	return taskDto;
};
