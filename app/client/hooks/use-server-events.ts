import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { serverEventNames, type ServerEventPayloadMap } from "~/schemas/server-events";

type LifecycleEventPayloadMap = {
	connected: { type: "connected"; timestamp: number };
	heartbeat: { timestamp: number };
};

type ServerEventsPayloadMap = LifecycleEventPayloadMap & ServerEventPayloadMap;
type ServerEventType = keyof ServerEventsPayloadMap;

type EventHandler<T extends ServerEventType> = (data: ServerEventsPayloadMap[T]) => void;
type EventHandlerSet<T extends ServerEventType> = Set<EventHandler<T>>;
type EventHandlerMap = {
	[K in ServerEventType]?: EventHandlerSet<K>;
};

type SharedServerEventsState = {
	eventSource: EventSource | null;
	handlers: EventHandlerMap;
	queryClient: QueryClient | null;
	subscribers: number;
};

const invalidatingEvents = new Set<ServerEventType>([
	"backup:completed",
	"volume:updated",
	"volume:status_changed",
	"mirror:completed",
	"doctor:started",
	"doctor:completed",
	"doctor:cancelled",
]);

export type RestoreEvent = ServerEventsPayloadMap["restore:started"] | ServerEventsPayloadMap["restore:completed"];
export type RestoreProgressEvent = ServerEventsPayloadMap["restore:progress"];
export type RestoreCompletedEvent = ServerEventsPayloadMap["restore:completed"];
export type BackupProgressEvent = ServerEventsPayloadMap["backup:progress"];

const sharedState: SharedServerEventsState = {
	eventSource: null,
	handlers: {},
	queryClient: null,
	subscribers: 0,
};

const parseEventData = <T extends ServerEventType>(event: Event): ServerEventsPayloadMap[T] =>
	JSON.parse((event as MessageEvent<string>).data) as ServerEventsPayloadMap[T];

const isAbortError = (error: unknown): error is Error => error instanceof Error && error.name === "AbortError";

const emit = <T extends ServerEventType>(eventName: T, data: ServerEventsPayloadMap[T]) => {
	const handlers = sharedState.handlers[eventName] as EventHandlerSet<T> | undefined;
	handlers?.forEach((handler) => {
		handler(data);
	});
};

const refreshQueriesForEvent = (eventName: ServerEventType) => {
	if (!invalidatingEvents.has(eventName) || !sharedState.queryClient) {
		return;
	}

	void sharedState.queryClient.invalidateQueries().catch((error) => {
		if (!isAbortError(error)) {
			console.error(`[SSE] Failed to refresh queries after ${eventName}:`, error);
		}
	});
};

const connectEventSource = (queryClient: QueryClient) => {
	sharedState.queryClient = queryClient;
	if (sharedState.eventSource) {
		return;
	}

	const eventSource = new EventSource("/api/v1/events");
	sharedState.eventSource = eventSource;

	eventSource.addEventListener("connected", (event) => {
		const data = parseEventData<"connected">(event);
		console.info("[SSE] Connected to server events");
		emit("connected", data);
	});

	eventSource.addEventListener("heartbeat", (event) => {
		emit("heartbeat", parseEventData<"heartbeat">(event));
	});

	for (const eventName of serverEventNames) {
		eventSource.addEventListener(eventName, (event) => {
			const data = parseEventData<typeof eventName>(event);
			console.info(`[SSE] ${eventName}:`, data);

			refreshQueriesForEvent(eventName);

			if (eventName === "volume:status_changed") {
				const statusData = data as ServerEventsPayloadMap["volume:status_changed"];
				emit("volume:status_changed", statusData);
				emit("volume:updated", statusData);
				return;
			}

			emit(eventName, data);
		});
	}

	eventSource.onerror = (error) => {
		console.error("[SSE] Connection error:", error);
	};
};

const disconnectEventSource = () => {
	if (!sharedState.eventSource) {
		return;
	}

	console.info("[SSE] Disconnecting from server events");
	sharedState.eventSource.close();
	sharedState.eventSource = null;
	sharedState.queryClient = null;
	sharedState.handlers = {};
};

const addSharedEventListener = <T extends ServerEventType>(
	eventName: T,
	handler: EventHandler<T>,
	options?: { signal?: AbortSignal },
) => {
	if (options?.signal?.aborted) {
		return () => {};
	}

	const existingHandlers = sharedState.handlers[eventName] as EventHandlerSet<T> | undefined;
	const eventHandlers = existingHandlers ?? new Set<EventHandler<T>>();
	eventHandlers.add(handler);
	sharedState.handlers[eventName] = eventHandlers as EventHandlerMap[T];

	const unsubscribe = () => {
		const handlers = sharedState.handlers[eventName] as EventHandlerSet<T> | undefined;
		handlers?.delete(handler);
		if (handlers && handlers.size === 0) {
			delete sharedState.handlers[eventName];
		}
		if (options?.signal) {
			options.signal.removeEventListener("abort", unsubscribe);
		}
	};

	if (options?.signal) {
		options.signal.addEventListener("abort", unsubscribe, { once: true });
	}

	return unsubscribe;
};

/**
 * Hook to listen to Server-Sent Events (SSE) from the backend
 * Automatically handles cache invalidation for backup and volume events
 */
export function useServerEvents() {
	const queryClient = useQueryClient();
	const addEventListener = useCallback(addSharedEventListener, []);
	const hasMountedRef = useRef(false);

	useEffect(() => {
		connectEventSource(queryClient);
		if (!hasMountedRef.current) {
			sharedState.subscribers += 1;
			hasMountedRef.current = true;
		}

		return () => {
			if (!hasMountedRef.current) {
				return;
			}

			hasMountedRef.current = false;
			sharedState.subscribers = Math.max(0, sharedState.subscribers - 1);
			if (sharedState.subscribers === 0) {
				disconnectEventSource();
			}
		};
	}, [queryClient]);

	return { addEventListener };
}
