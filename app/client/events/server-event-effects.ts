import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { logger } from "~/client/lib/logger";
import type { ServerEventPayloadMap } from "~/schemas/server-events";

type ServerEventType = keyof ServerEventPayloadMap;

type EventNotification = {
	type: "error" | "success";
	message: string;
	description?: string;
};

type ServerEventEffect<T extends ServerEventType> = {
	invalidateQueries?: boolean;
	notify?: (data: ServerEventPayloadMap[T]) => EventNotification | null;
	updateQueries?: (queryClient: QueryClient, data: ServerEventPayloadMap[T]) => void;
	emitAs?: ServerEventType[];
};

type ServerEventEffectMap = {
	[K in ServerEventType]?: ServerEventEffect<K>;
};

const isAbortError = (error: unknown): error is Error => error instanceof Error && error.name === "AbortError";

const serverEventEffects: ServerEventEffectMap = {
	"backup:started": { invalidateQueries: true },
	"backup:completed": { invalidateQueries: true },
	"volume:updated": { invalidateQueries: true },
	"volume:status_changed": { invalidateQueries: true, emitAs: ["volume:updated"] },
	"notification:updated": { invalidateQueries: true },
	"mirror:completed": { invalidateQueries: true },
	"task:started": { invalidateQueries: true },
	"task:finished": { invalidateQueries: true },
};

const getServerEventEffect = <T extends ServerEventType>(eventName: T): ServerEventEffect<T> | undefined => {
	return serverEventEffects[eventName] as ServerEventEffect<T> | undefined;
};

const invalidateQueriesForEvent = (queryClient: QueryClient, eventName: ServerEventType) => {
	const eventEffect = getServerEventEffect(eventName);
	if (!eventEffect?.invalidateQueries) {
		return;
	}

	void queryClient.invalidateQueries().catch((error) => {
		if (!isAbortError(error)) {
			logger.error(`[SSE] Failed to refresh queries after ${eventName}:`, error);
		}
	});
};

const updateQueriesForEvent = <T extends ServerEventType>(
	queryClient: QueryClient,
	eventName: T,
	data: ServerEventPayloadMap[T],
) => {
	getServerEventEffect(eventName)?.updateQueries?.(queryClient, data);
};

const notifyForEvent = <T extends ServerEventType>(eventName: T, data: ServerEventPayloadMap[T]) => {
	const notification = getServerEventEffect(eventName)?.notify?.(data);
	if (!notification) {
		return;
	}

	toast[notification.type](notification.message, { description: notification.description });
};

const applyEffectsForEvent = <T extends ServerEventType>(
	queryClient: QueryClient,
	eventName: T,
	data: ServerEventPayloadMap[T],
) => {
	updateQueriesForEvent(queryClient, eventName, data);
	invalidateQueriesForEvent(queryClient, eventName);
	notifyForEvent(eventName, data);
};

export const getServerEventAliases = (eventName: ServerEventType) => {
	return getServerEventEffect(eventName)?.emitAs ?? [];
};

export const applyServerEventEffects = <T extends ServerEventType>(
	queryClient: QueryClient,
	eventName: T,
	data: ServerEventPayloadMap[T],
) => {
	applyEffectsForEvent(queryClient, eventName, data);

	for (const alias of getServerEventAliases(eventName)) {
		const aliasData = data as ServerEventPayloadMap[typeof alias];
		applyEffectsForEvent(queryClient, alias, aliasData);
	}
};
