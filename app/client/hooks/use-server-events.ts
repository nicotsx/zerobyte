import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
	BackupCompletedEventDto,
	BackupProgressEventDto,
	BackupStartedEventDto,
} from "~/schemas/events-dto";

type ServerEventType =
	| "connected"
	| "heartbeat"
	| "backup:started"
	| "backup:progress"
	| "backup:completed"
	| "volume:mounted"
	| "volume:unmounted"
	| "volume:updated"
	| "mirror:started"
	| "mirror:completed"
	| "doctor:started"
	| "doctor:completed"
	| "doctor:cancelled";

export interface VolumeEvent {
	volumeName: string;
}

export interface MirrorEvent {
	scheduleId: number;
	repositoryId: string;
	repositoryName: string;
	status?: "success" | "error" | "in_progress";
	error?: string;
}

export interface DoctorEvent {
	repositoryId: string;
	repositoryName: string;
	error?: string;
}

export interface DoctorCompletedEvent extends DoctorEvent {
	success: boolean;
	completedAt: number;
	steps: Array<{
		step: string;
		success: boolean;
		output: string | null;
		error: string | null;
	}>;
}

type EventHandler = (data: unknown) => void;

/**
 * Hook to listen to Server-Sent Events (SSE) from the backend
 * Automatically handles cache invalidation for backup and volume events
 */
export function useServerEvents() {
	const queryClient = useQueryClient();
	const eventSourceRef = useRef<EventSource | null>(null);
	const handlersRef = useRef<Map<ServerEventType, Set<EventHandler>>>(new Map());

	useEffect(() => {
		const eventSource = new EventSource("/api/v1/events");
		eventSourceRef.current = eventSource;

		eventSource.addEventListener("connected", () => {
			console.info("[SSE] Connected to server events");
		});

		eventSource.addEventListener("heartbeat", () => {});

		eventSource.addEventListener("backup:started", (e) => {
			const data = JSON.parse(e.data) as BackupStartedEventDto;
			console.info("[SSE] Backup started:", data);

			handlersRef.current.get("backup:started")?.forEach((handler) => {
				handler(data);
			});
		});

		eventSource.addEventListener("backup:progress", (e) => {
			const data = JSON.parse(e.data) as BackupProgressEventDto;

			handlersRef.current.get("backup:progress")?.forEach((handler) => {
				handler(data);
			});
		});

		eventSource.addEventListener("backup:completed", (e) => {
			const data = JSON.parse(e.data) as BackupCompletedEventDto;
			console.info("[SSE] Backup completed:", data);

			void queryClient.invalidateQueries();
			void queryClient.refetchQueries();

			handlersRef.current.get("backup:completed")?.forEach((handler) => {
				handler(data);
			});
		});

		eventSource.addEventListener("volume:mounted", (e) => {
			const data = JSON.parse(e.data) as VolumeEvent;
			console.info("[SSE] Volume mounted:", data);

			handlersRef.current.get("volume:mounted")?.forEach((handler) => {
				handler(data);
			});
		});

		eventSource.addEventListener("volume:unmounted", (e) => {
			const data = JSON.parse(e.data) as VolumeEvent;
			console.info("[SSE] Volume unmounted:", data);

			handlersRef.current.get("volume:unmounted")?.forEach((handler) => {
				handler(data);
			});
		});

		eventSource.addEventListener("volume:updated", (e) => {
			const data = JSON.parse(e.data) as VolumeEvent;
			console.info("[SSE] Volume updated:", data);

			void queryClient.invalidateQueries();

			handlersRef.current.get("volume:updated")?.forEach((handler) => {
				handler(data);
			});
		});

		eventSource.addEventListener("volume:status_changed", (e) => {
			const data = JSON.parse(e.data) as VolumeEvent;
			console.info("[SSE] Volume status updated:", data);

			void queryClient.invalidateQueries();

			handlersRef.current.get("volume:updated")?.forEach((handler) => {
				handler(data);
			});
		});

		eventSource.addEventListener("mirror:started", (e) => {
			const data = JSON.parse(e.data) as MirrorEvent;
			console.info("[SSE] Mirror copy started:", data);

			handlersRef.current.get("mirror:started")?.forEach((handler) => {
				handler(data);
			});
		});

		eventSource.addEventListener("mirror:completed", (e) => {
			const data = JSON.parse(e.data) as MirrorEvent;
			console.info("[SSE] Mirror copy completed:", data);

			// Invalidate queries to refresh mirror status in the UI
			void queryClient.invalidateQueries();

			handlersRef.current.get("mirror:completed")?.forEach((handler) => {
				handler(data);
			});
		});

		eventSource.addEventListener("doctor:started", (e) => {
			const data = JSON.parse(e.data) as DoctorEvent;
			console.info("[SSE] Doctor started:", data);

			void queryClient.invalidateQueries();

			handlersRef.current.get("doctor:started")?.forEach((handler) => {
				handler(data);
			});
		});

		eventSource.addEventListener("doctor:completed", (e) => {
			const data = JSON.parse(e.data) as DoctorCompletedEvent;
			console.info("[SSE] Doctor completed:", data);

			void queryClient.invalidateQueries();

			handlersRef.current.get("doctor:completed")?.forEach((handler) => {
				handler(data);
			});
		});

		eventSource.addEventListener("doctor:cancelled", (e) => {
			const data = JSON.parse(e.data) as DoctorEvent;
			console.info("[SSE] Doctor cancelled:", data);

			void queryClient.invalidateQueries();

			handlersRef.current.get("doctor:cancelled")?.forEach((handler) => {
				handler(data);
			});
		});

		eventSource.onerror = (error) => {
			console.error("[SSE] Connection error:", error);
		};

		return () => {
			console.info("[SSE] Disconnecting from server events");
			eventSource.close();
			eventSourceRef.current = null;
		};
	}, [queryClient]);

	const addEventListener = (event: ServerEventType, handler: EventHandler) => {
		if (!handlersRef.current.has(event)) {
			handlersRef.current.set(event, new Set());
		}
		handlersRef.current.get(event)?.add(handler);

		return () => {
			handlersRef.current.get(event)?.delete(handler);
		};
	};

	return { addEventListener };
}
