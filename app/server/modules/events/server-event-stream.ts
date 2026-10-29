import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { logger } from "@zerobyte/core/node";

type SseStream = Parameters<Parameters<typeof streamSSE>[1]>[0];
type EventPayloadMap = Record<string, unknown>;

type StreamEventOptions<TPayloadMap extends EventPayloadMap, TEventName extends Extract<keyof TPayloadMap, string>> = {
	connectionLabel: string;
	events: readonly TEventName[];
	authorize: () => boolean | Promise<boolean>;
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
	logger.debug(`Client connected to ${options.connectionLabel} SSE endpoint`);

	return streamSSE(c, async (stream) => {
		let keepAlive = true;
		let cleanedUp = false;
		let sendQueue = Promise.resolve(true);
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
			logger.debug(`Client disconnected from ${options.connectionLabel} SSE endpoint`);
			keepAlive = false;
			cleanup();
		}

		async function closeStream() {
			if (!keepAlive) return;
			keepAlive = false;
			cleanup();

			if (!stream.closed) await stream.close();
		}

		async function ensureAuthorized() {
			if (!keepAlive) return false;

			try {
				const authorized = await options.authorize();
				if (!keepAlive) return false;
				if (authorized) return true;
			} catch (error) {
				logger.warn(`Authorization refresh failed for ${options.connectionLabel} SSE endpoint`, { error });
			}

			await closeStream();
			return false;
		}

		function enqueue(write: () => Promise<void>) {
			sendQueue = sendQueue.then(async () => {
				if (!(await ensureAuthorized())) return false;
				if (!keepAlive || stream.closed) return false;

				await write();
				return true;
			});

			sendQueue = sendQueue.catch(async (error) => {
				logger.warn(`Event delivery failed for ${options.connectionLabel} SSE endpoint`, { error });
				await closeStream();
				return false;
			});

			return sendQueue;
		}

		stream.onAbort(handleDisconnect);
		c.req.raw.signal.addEventListener("abort", handleDisconnect, { once: true });

		try {
			const connected = enqueue(async () => {
				await stream.writeSSE({
					data: JSON.stringify({ type: "connected", timestamp: Date.now() }),
					event: "connected",
				});

				await options.onConnected?.(stream);
			});

			for (const eventName of options.events) {
				unsubscribers.push(
					options.subscribe(eventName, (data) => {
						if (!options.shouldSend(eventName, data)) return;

						void enqueue(async () => {
							const payload = options.toPayload?.(eventName, data) ?? data;
							await stream.writeSSE({
								data: JSON.stringify(payload),
								event: eventName,
							});
						});
					}),
				);
			}

			if (!(await connected)) return;

			while (keepAlive && !c.req.raw.signal.aborted && !stream.aborted) {
				const sent = await enqueue(async () => {
					await stream.writeSSE({ data: JSON.stringify({ timestamp: Date.now() }), event: "heartbeat" });
				});
				if (!sent) break;
				await stream.sleep(5000);
			}
		} finally {
			cleanup();
		}
	});
};
