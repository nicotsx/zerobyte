import type {
	ServerBackupCompletedEventDto,
	ServerBackupProgressEventDto,
	ServerBackupStartedEventDto,
	ServerDumpStartedEventDto,
} from "~/schemas/events-dto";
import type { TaskHistoryLifecycleItem, TaskHistoryOutcome } from "~/schemas/task-history";

const payload = <T>() => undefined as unknown as T;

type TaskHistoryChangedEvent = {
	organizationId: string;
	previousOutcome: TaskHistoryOutcome | null;
	item: TaskHistoryLifecycleItem;
};

export const serverEventPayloads = {
	"backup:started": payload<ServerBackupStartedEventDto>(),
	"backup:progress": payload<ServerBackupProgressEventDto>(),
	"backup:completed": payload<ServerBackupCompletedEventDto>(),
	"dump:started": payload<ServerDumpStartedEventDto>(),
	"volume:mounted": payload<{ organizationId: string; volumeName: string }>(),
	"volume:unmounted": payload<{ organizationId: string; volumeName: string }>(),
	"volume:updated": payload<{ organizationId: string; volumeName: string }>(),
	"volume:status_changed": payload<{
		organizationId: string;
		volumeName: string;
		status: string;
	}>(),
	"notification:updated": payload<{
		organizationId: string;
		notificationId: number;
		notificationName: string;
		status: "healthy" | "error" | "unknown";
	}>(),
	"task:history-changed": payload<TaskHistoryChangedEvent>(),
} as const;

export type ServerEventPayloadMap = typeof serverEventPayloads;

export type ServerEventHandlers = {
	[EventName in keyof ServerEventPayloadMap]: (data: ServerEventPayloadMap[EventName]) => void;
};

export const serverEventNames = Object.keys(serverEventPayloads) as Array<keyof ServerEventPayloadMap>;
