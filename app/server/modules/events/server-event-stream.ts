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
		let keepAlive = true;
		let cleanedUp = false;
		const unsubscribers: Array<() => void> = [];

		function cleanup() {
			if (cleanedUp) return;
			cleanedUp = true;

			c.req.raw.signal.removeEventListener("abort", handleDisconnect);
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

		function isExpectedDisconnectError(error: unknown) {
			const isAbortError = error instanceof Error && error.name === "AbortError";
			return c.req.raw.signal.aborted || stream.aborted || isAbortError;
		}

		function handleStreamError(error: unknown) {
			if (isExpectedDisconnectError(error)) {
				handleDisconnect();
				return;
			}

			logger.error(`Failed to write to ${options.connectionLabel} SSE stream:`, error);
			keepAlive = false;
			cleanup();
		}

		async function writeEvent(event: string, payload: unknown) {
			if (!keepAlive || c.req.raw.signal.aborted || stream.aborted) {
				handleDisconnect();
				return false;
			}

			try {
				await stream.writeSSE({
					data: JSON.stringify(payload),
					event,
				});
				return true;
			} catch (error) {
				handleStreamError(error);
				return false;
			}
		}

		for (const eventName of options.events) {
			const unsubscribe = options.subscribe(eventName, async (data) => {
				try {
					if (!options.shouldSend(eventName, data)) return;

					const payload = options.toPayload?.(eventName, data) ?? data;
					await writeEvent(eventName, payload);
				} catch (error) {
					handleStreamError(error);
				}
			});

			if (cleanedUp) {
				unsubscribe();
				continue;
			}

			unsubscribers.push(unsubscribe);
		}

		stream.onAbort(handleDisconnect);
		c.req.raw.signal.addEventListener("abort", handleDisconnect, { once: true });

		try {
			const didWriteConnectionEvent = await writeEvent("connected", { type: "connected", timestamp: Date.now() });
			if (!didWriteConnectionEvent) return;

			try {
				await options.onConnected?.(stream);
			} catch (error) {
				handleStreamError(error);
				return;
			}

			while (keepAlive && !c.req.raw.signal.aborted && !stream.aborted) {
				const didWriteHeartbeat = await writeEvent("heartbeat", { timestamp: Date.now() });
				if (!didWriteHeartbeat) return;

				if (!keepAlive || c.req.raw.signal.aborted || stream.aborted) {
					handleDisconnect();
					return;
				}

				try {
					await stream.sleep(5000);
				} catch (error) {
					handleStreamError(error);
					return;
				}
			}
		} finally {
			cleanup();
		}
	});
};
