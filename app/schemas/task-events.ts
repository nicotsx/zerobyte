import type { TaskDto } from "~/schemas/tasks";

export const taskChangedEventName = "task:changed";
export const taskEventNames = [taskChangedEventName] as const;

export type TaskEventName = (typeof taskEventNames)[number];
export type TaskEventPayloadMap = {
	[taskChangedEventName]: TaskDto;
};
