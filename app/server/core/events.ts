import { EventEmitter } from "node:events";
import type { TypedEmitter } from "tiny-typed-emitter";
import type { DoctorResult } from "~/schemas/restic";
import type {
	ServerBackupCompletedEventDto,
	ServerBackupProgressEventDto,
	ServerBackupStartedEventDto,
} from "~/schemas/events-dto";

/**
 * Event payloads for the SSE system
 */
interface ServerEvents {
	"backup:started": (data: ServerBackupStartedEventDto) => void;
	"backup:progress": (data: ServerBackupProgressEventDto) => void;
	"backup:completed": (data: ServerBackupCompletedEventDto) => void;
	"mirror:started": (data: {
		organizationId: string;
		scheduleId: number;
		repositoryId: string;
		repositoryName: string;
	}) => void;
	"mirror:completed": (data: {
		organizationId: string;
		scheduleId: number;
		repositoryId: string;
		repositoryName: string;
		status: "success" | "error";
		error?: string;
	}) => void;
	"volume:mounted": (data: { organizationId: string; volumeName: string }) => void;
	"volume:unmounted": (data: { organizationId: string; volumeName: string }) => void;
	"volume:updated": (data: { organizationId: string; volumeName: string }) => void;
	"volume:status_changed": (data: { organizationId: string; volumeName: string; status: string }) => void;
	"doctor:started": (data: { organizationId: string; repositoryId: string; repositoryName: string }) => void;
	"doctor:completed": (
		data: {
			organizationId: string;
			repositoryId: string;
			repositoryName: string;
		} & DoctorResult,
	) => void;
	"doctor:cancelled": (data: {
		organizationId: string;
		repositoryId: string;
		repositoryName: string;
		error?: string;
	}) => void;
}

/**
 * Global event emitter for server-side events
 * Use this to emit events that should be broadcasted to connected clients via SSE
 */
export const serverEvents = new EventEmitter() as TypedEmitter<ServerEvents>;
