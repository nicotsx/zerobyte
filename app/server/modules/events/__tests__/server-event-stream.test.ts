import { Hono } from "hono";
import { expect, test, vi } from "vitest";
import { streamEvents } from "../server-event-stream";

type TestEventMap = {
	message: { sequence: number };
};

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});

	return { promise, resolve };
};

const readUntil = async (reader: ReadableStreamDefaultReader<Uint8Array>, matcher: string) => {
	const decoder = new TextDecoder();
	let text = "";

	for (let i = 0; i < 10 && !text.includes(matcher); i++) {
		const result = await reader.read();
		if (result.done) break;
		text += decoder.decode(result.value, { stream: true });
	}

	return text;
};

const parseMessageSequences = (text: string) => {
	return text
		.replaceAll("\r\n", "\n")
		.split("\n\n")
		.filter((frame) => frame.includes("event: message"))
		.map((frame) => {
			const data = frame
				.split("\n")
				.filter((line) => line.startsWith("data: "))
				.map((line) => line.slice("data: ".length))
				.join("\n");

			return (JSON.parse(data) as TestEventMap["message"]).sequence;
		});
};

const createStreamHarness = (authorize: () => boolean | Promise<boolean>) => {
	const handlers = new Set<(data: TestEventMap["message"]) => void | Promise<void>>();
	const unsubscribe = vi.fn();
	const toPayload = vi.fn((_eventName: "message", data: TestEventMap["message"]) => data);
	const app = new Hono().get("/", (c) =>
		streamEvents<TestEventMap, "message">(c, {
			connectionLabel: "test",
			events: ["message"],
			authorize,
			shouldSend: () => true,
			toPayload,
			subscribe: (_eventName, handler) => {
				handlers.add(handler);

				return () => {
					handlers.delete(handler);
					unsubscribe();
				};
			},
		}),
	);

	return {
		app,
		emit: (sequence: number) => {
			for (const handler of handlers) void handler({ sequence });
		},
		toPayload,
		unsubscribe,
	};
};

test("preserves event order while authorization refresh is delayed", async () => {
	const refresh = deferred<boolean>();
	const authorizationResults = [true, refresh.promise, true];
	const authorize = vi.fn(() => authorizationResults.shift() ?? true);
	const harness = createStreamHarness(authorize);
	const response = await harness.app.request("/");
	const reader = response.body!.getReader();

	try {
		await readUntil(reader, "event: connected");

		harness.emit(1);
		harness.emit(2);
		const pendingDelivery = reader.read();
		let deliverySettled = false;
		void pendingDelivery.finally(() => {
			deliverySettled = true;
		});

		await vi.waitFor(() => expect(authorize).toHaveBeenCalledTimes(2));
		await Promise.resolve();
		expect(deliverySettled).toBe(false);
		expect(harness.toPayload).not.toHaveBeenCalled();

		refresh.resolve(true);

		const firstDelivery = await pendingDelivery;
		const firstText = firstDelivery.done ? "" : new TextDecoder().decode(firstDelivery.value);
		const remainingText = firstText.includes('"sequence":2') ? "" : await readUntil(reader, '"sequence":2');

		expect(parseMessageSequences(firstText + remainingText)).toEqual([1, 2]);
	} finally {
		await reader.cancel();
		reader.releaseLock();
	}
});

test("does not resume delivery after disconnecting during authorization", async () => {
	const refresh = deferred<boolean>();
	const authorize = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(refresh.promise);
	const harness = createStreamHarness(authorize);
	const abortController = new AbortController();
	const response = await harness.app.request("/", { signal: abortController.signal });
	const reader = response.body!.getReader();

	try {
		await readUntil(reader, "event: connected");

		harness.emit(1);
		await vi.waitFor(() => expect(authorize).toHaveBeenCalledTimes(2));

		abortController.abort();
		refresh.resolve(true);

		await vi.waitFor(() => expect(harness.unsubscribe).toHaveBeenCalledOnce());
		expect(harness.toPayload).not.toHaveBeenCalled();
	} finally {
		await reader.cancel();
		reader.releaseLock();
	}
});
