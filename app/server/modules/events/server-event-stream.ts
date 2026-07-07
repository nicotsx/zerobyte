import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { logger } from "@zerobyte/core/node";

type SseStream = Parameters<Parameters<typeof streamSSE>[1]>[0];
type EventPayloadMap = Record<string, unknown>;

type StreamEventOptions<TPayloadMap extends EventPayloadMap, TEventName extends Extract<keyof TPayloadMap, string>> = {
	connectionLabel: string;
	events: readonly TEventName[];
	onConnected?: (stream: SseStream) => Promise<void>;
	shouldSend: <Name extends TEventName>(eventName: Name, data: TPayloadMap[Name]) => boolean;
	toPayload?: <Name extends TEventName>(eventName: Name, data: TPayloadMap[Name]) => unknown;
	subscribe: <Name extends TEventName>(
		eventName: Name,
		handler: (data: TPayloadMap[Name]) => void | Promise<void>,
	) => () => void;
};

export const streamEvents = <
	TPayloadMap extends EventPayloadMap,
	TEventName extends Extract<keyof TPayloadMap, string>,
>(
	c: Context,
	options: StreamEventOptions<TPayloadMap, TEventName>,
) => {
	logger.info(`Client connected to ${options.connectionLabel} SSE endpoint`);

	return streamSSE(c, async (stream) => {
		const unsubscribers = options.events.map((eventName) => {
			return options.subscribe(eventName, async (data) => {
				if (!options.shouldSend(eventName, data)) return;
				const payload = options.toPayload?.(eventName, data) ?? data;
				await stream.writeSSE({
					data: JSON.stringify(payload),
					event: eventName,
				});
			});
		});

		let keepAlive = true;
		let cleanedUp = false;

		function cleanup() {
			if (cleanedUp) return;
			cleanedUp = true;

			c.req.raw.signal.removeEventListener("abort", onRequestAbort);
			for (const unsubscribe of unsubscribers) {
				unsubscribe();
			}
		}

		function handleDisconnect() {
			if (!keepAlive) return;
			logger.info(`Client disconnected from ${options.connectionLabel} SSE endpoint`);
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
			await stream.writeSSE({
				data: JSON.stringify({ type: "connected", timestamp: Date.now() }),
				event: "connected",
			});

			await options.onConnected?.(stream);

			while (keepAlive && !c.req.raw.signal.aborted && !stream.aborted) {
				await stream.writeSSE({ data: JSON.stringify({ timestamp: Date.now() }), event: "heartbeat" });
				await stream.sleep(5000);
			}
		} finally {
			cleanup();
		}
	});
};
