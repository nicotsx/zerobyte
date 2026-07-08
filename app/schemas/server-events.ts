import type {
	ServerBackupCompletedEventDto,
	ServerBackupProgressEventDto,
	ServerBackupStartedEventDto,
	ServerDumpStartedEventDto,
	ServerRestoreCompletedEventDto,
	ServerRestoreProgressEventDto,
	ServerRestoreStartedEventDto,
} from "~/schemas/events-dto";
import type { TaskKind, TaskResourceType, TaskStatus } from "~/schemas/tasks";

const payload = <T>() => undefined as unknown as T;

type TaskLifecycleEvent = {
	organizationId: string;
	taskId: string;
	kind: TaskKind;
	resourceType: TaskResourceType;
	resourceId: string;
	status: TaskStatus;
};

export const serverEventPayloads = {
	"backup:started": payload<ServerBackupStartedEventDto>(),
	"backup:progress": payload<ServerBackupProgressEventDto>(),
	"backup:completed": payload<ServerBackupCompletedEventDto>(),
	"restore:started": payload<ServerRestoreStartedEventDto>(),
	"restore:progress": payload<ServerRestoreProgressEventDto>(),
	"restore:completed": payload<ServerRestoreCompletedEventDto>(),
	"dump:started": payload<ServerDumpStartedEventDto>(),
	"mirror:started": payload<{
		organizationId: string;
		scheduleId: string;
		repositoryId: string;
		repositoryName: string;
	}>(),
	"mirror:completed": payload<{
		organizationId: string;
		scheduleId: string;
		repositoryId: string;
		repositoryName: string;
		status: "success" | "error";
		error?: string;
	}>(),
	"volume:mounted": payload<{ organizationId: string; volumeName: string }>(),
	"volume:unmounted": payload<{ organizationId: string; volumeName: string }>(),
	"volume:updated": payload<{ organizationId: string; volumeName: string }>(),
	"volume:status_changed": payload<{ organizationId: string; volumeName: string; status: string }>(),
	"notification:updated": payload<{
		organizationId: string;
		notificationId: number;
		notificationName: string;
		status: "healthy" | "error" | "unknown";
	}>(),
	"task:started": payload<TaskLifecycleEvent>(),
	"task:finished": payload<TaskLifecycleEvent>(),
} as const;

export type ServerEventPayloadMap = typeof serverEventPayloads;

export type ServerEventHandlers = {
	[EventName in keyof ServerEventPayloadMap]: (data: ServerEventPayloadMap[EventName]) => void;
};

export const serverEventNames = Object.keys(serverEventPayloads) as Array<keyof ServerEventPayloadMap>;
