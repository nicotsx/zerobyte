import { taskDtoSchema, type ParsedTask, type TaskDto } from "~/schemas/tasks";

export const toTaskDto = (task: ParsedTask): TaskDto => {
	return taskDtoSchema.parse(task);
};
