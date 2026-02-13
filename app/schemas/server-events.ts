import type {
	ServerBackupCompletedEventDto,
	ServerBackupProgressEventDto,
	ServerBackupStartedEventDto,
	ServerRestoreCompletedEventDto,
	ServerRestoreProgressEventDto,
	ServerRestoreStartedEventDto,
} from "~/schemas/events-dto";
import type { DoctorResult } from "~/schemas/restic";

const payload = <T>() => undefined as unknown as T;

/**
 * Single runtime registry for all broadcastable server events.
 * Used as source-of-truth for both event names and payload typing.
 */
export const serverEventPayloads = {
	"backup:started": payload<ServerBackupStartedEventDto>(),
	"backup:progress": payload<ServerBackupProgressEventDto>(),
	"backup:completed": payload<ServerBackupCompletedEventDto>(),
	"restore:started": payload<ServerRestoreStartedEventDto>(),
	"restore:progress": payload<ServerRestoreProgressEventDto>(),
	"restore:completed": payload<ServerRestoreCompletedEventDto>(),
	"mirror:started": payload<{
		organizationId: string;
		scheduleId: number;
		repositoryId: string;
		repositoryName: string;
	}>(),
	"mirror:completed": payload<{
		organizationId: string;
		scheduleId: number;
		repositoryId: string;
		repositoryName: string;
		status: "success" | "error";
		error?: string;
	}>(),
	"volume:mounted": payload<{ organizationId: string; volumeName: string }>(),
	"volume:unmounted": payload<{ organizationId: string; volumeName: string }>(),
	"volume:updated": payload<{ organizationId: string; volumeName: string }>(),
	"volume:status_changed": payload<{ organizationId: string; volumeName: string; status: string }>(),
	"doctor:started": payload<{ organizationId: string; repositoryId: string; repositoryName: string }>(),
	"doctor:completed": payload<
		{
			organizationId: string;
			repositoryId: string;
			repositoryName: string;
		} & DoctorResult
	>(),
	"doctor:cancelled": payload<{
		organizationId: string;
		repositoryId: string;
		repositoryName: string;
		error?: string;
	}>(),
} as const;

export type ServerEventPayloadMap = typeof serverEventPayloads;

export type ServerEventHandlers = {
	[K in keyof ServerEventPayloadMap]: (data: ServerEventPayloadMap[K]) => void;
};

export const serverEventNames = Object.keys(serverEventPayloads) as Array<keyof ServerEventPayloadMap>;
