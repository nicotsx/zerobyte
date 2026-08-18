import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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

const serverEventEffects: ServerEventEffectMap = {
	"task:history-changed": { invalidateQueries: true },
	"volume:updated": { invalidateQueries: true },
	"volume:status_changed": { invalidateQueries: true, emitAs: ["volume:updated"] },
	"notification:updated": { invalidateQueries: true },
};

const getServerEventEffect = <T extends ServerEventType>(eventName: T): ServerEventEffect<T> | undefined => {
	return serverEventEffects[eventName] as ServerEventEffect<T> | undefined;
};

export const invalidateServerEventQueries = (queryClient: QueryClient) => {
	void queryClient.invalidateQueries(undefined, { cancelRefetch: false });
};

const invalidateQueriesForEvent = (queryClient: QueryClient, eventName: ServerEventType) => {
	const eventEffect = getServerEventEffect(eventName);
	if (!eventEffect?.invalidateQueries) {
		return;
	}

	invalidateServerEventQueries(queryClient);
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
