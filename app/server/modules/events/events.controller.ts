import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serverEvents } from "../../core/events";
import { logger } from "../../utils/logger";
import { requireAuth } from "../auth/auth.middleware";
import type { ServerEventPayloadMap } from "~/schemas/server-events";

type OrganizationScopedEvent = {
	[EventName in keyof ServerEventPayloadMap]: ServerEventPayloadMap[EventName] extends {
		organizationId: string;
	}
		? EventName
		: never;
}[keyof ServerEventPayloadMap];

const broadcastEvents = [
	"backup:started",
	"backup:progress",
	"backup:completed",
	"volume:mounted",
	"volume:unmounted",
	"volume:updated",
	"mirror:started",
	"mirror:completed",
	"restore:started",
	"restore:progress",
	"restore:completed",
	"doctor:started",
	"doctor:completed",
	"doctor:cancelled",
] as const satisfies OrganizationScopedEvent[];

type BroadcastEvent = (typeof broadcastEvents)[number];

export const eventsController = new Hono().use(requireAuth).get("/", (c) => {
	logger.info("Client connected to SSE endpoint");
	const organizationId = c.get("organizationId");

	return streamSSE(c, async (stream) => {
		await stream.writeSSE({
			data: JSON.stringify({ type: "connected", timestamp: Date.now() }),
			event: "connected",
		});

		const createOrganizationEventHandler = <EventName extends BroadcastEvent>(event: EventName) => {
			return async (data: ServerEventPayloadMap[EventName]) => {
				if (data.organizationId !== organizationId) return;
				await stream.writeSSE({
					data: JSON.stringify(data),
					event,
				});
			};
		};

		const eventHandlers = broadcastEvents.reduce(
			(handlers, event) => {
				handlers[event] = createOrganizationEventHandler(event);
				return handlers;
			},
			{} as { [EventName in BroadcastEvent]: (data: ServerEventPayloadMap[EventName]) => Promise<void> },
		);

		for (const event of broadcastEvents) {
			serverEvents.on(event, eventHandlers[event]);
		}

		let keepAlive = true;
		let cleanedUp = false;

		function cleanup() {
			if (cleanedUp) return;
			cleanedUp = true;

			c.req.raw.signal.removeEventListener("abort", onRequestAbort);

			for (const event of broadcastEvents) {
				serverEvents.off(event, eventHandlers[event]);
			}
		}

		function handleDisconnect() {
			if (!keepAlive) return;
			logger.info("Client disconnected from SSE endpoint");
			keepAlive = false;
			cleanup();
		}

		function onRequestAbort() {
			handleDisconnect();
			stream.abort();
		}

		stream.onAbort(handleDisconnect);
		c.req.raw.signal.addEventListener("abort", onRequestAbort, { once: true });

		try {
			while (keepAlive && !c.req.raw.signal.aborted && !stream.aborted) {
				await stream.writeSSE({ data: JSON.stringify({ timestamp: Date.now() }), event: "heartbeat" });
				await stream.sleep(5000);
			}
		} finally {
			cleanup();
		}
	});
});
