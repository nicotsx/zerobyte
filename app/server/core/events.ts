import { EventEmitter } from "node:events";
import type { TypedEmitter } from "tiny-typed-emitter";

/**
 * Event payloads for the SSE system
 */
interface ServerEvents {
	"backup:started": (data: { scheduleId: number; volumeName: string; repositoryName: string }) => void;
	"backup:progress": (data: {
		scheduleId: number;
		volumeName: string;
		repositoryName: string;
		seconds_elapsed: number;
		percent_done: number;
		total_files: number;
		files_done: number;
		total_bytes: number;
		bytes_done: number;
		current_files: string[];
	}) => void;
	"backup:completed": (data: {
		scheduleId: number;
		volumeName: string;
		repositoryName: string;
		status: "success" | "error" | "stopped" | "warning";
	}) => void;
	"mirror:started": (data: { scheduleId: number; repositoryId: string; repositoryName: string }) => void;
	"mirror:completed": (data: {
		scheduleId: number;
		repositoryId: string;
		repositoryName: string;
		status: "success" | "error";
		error?: string;
	}) => void;
	"volume:mounted": (data: { volumeName: string }) => void;
	"volume:unmounted": (data: { volumeName: string }) => void;
	"volume:updated": (data: { volumeName: string }) => void;
	"volume:status_changed": (data: { volumeName: string; status: string }) => void;
}

/**
 * Global event emitter for server-side events
 * Use this to emit events that should be broadcasted to connected clients via SSE
 */
export const serverEvents = new EventEmitter() as TypedEmitter<ServerEvents>;
