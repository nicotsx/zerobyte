import { Hono } from "hono";
import { serverEvents } from "~/server/core/events";
import { serverEventNames, type ServerEventHandlers, type ServerEventPayloadMap } from "~/schemas/server-events";
import { requireAuth } from "../auth/auth.middleware";
import { streamEvents } from "./server-event-stream";

export const eventsController = new Hono().use(requireAuth).get("/", (c) => {
	const organizationId = c.get("organizationId");

	return streamEvents<ServerEventPayloadMap, (typeof serverEventNames)[number]>(c, {
		connectionLabel: "global events",
		events: serverEventNames,
		shouldSend: (_eventName, data) => data.organizationId === organizationId,
		subscribe: (eventName, handler) => {
			const listener = handler as unknown as ServerEventHandlers[typeof eventName];
			serverEvents.on(eventName, listener);
			return () => serverEvents.off(eventName, listener);
		},
	});
});
