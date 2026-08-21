import { describe, expect, test, vi } from "vitest";
import type { Context } from "hono";

const streamingMock = vi.hoisted(() => ({
	callback: undefined as undefined | ((stream: unknown) => Promise<void>),
}));

vi.mock("hono/streaming", () => ({
	streamSSE: (_context: unknown, callback: (stream: unknown) => Promise<void>) => {
		streamingMock.callback = callback;
		return new Response();
	},
}));

import { streamEvents } from "../server-event-stream";

type TestEvents = {
	updated: { id: string };
};

const waitFor = async (predicate: () => boolean) => {
	for (let attempt = 0; attempt < 20; attempt++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}

	expect(predicate()).toBe(true);
};

describe("streamEvents", () => {
	test("does not schedule a heartbeat wait when a successful heartbeat write aborts the request", async () => {
		const abortController = new AbortController();
		let unsubscribeCount = 0;
		let writeCount = 0;
		const stream = {
			aborted: false,
			onAbort: vi.fn(),
			sleep: vi.fn(() => Promise.resolve()),
			writeSSE: vi.fn(() => {
				writeCount += 1;
				if (writeCount === 2) abortController.abort();
				return Promise.resolve();
			}),
		};
		const context = {
			req: { raw: new Request("http://localhost/events", { signal: abortController.signal }) },
		} as Context;

		try {
			streamEvents<TestEvents, "updated">(context, {
				connectionLabel: "test events",
				events: ["updated"],
				shouldSend: () => true,
				subscribe: () => () => {
					unsubscribeCount += 1;
				},
			});

			const callback = streamingMock.callback;
			expect(callback).toBeDefined();
			if (!callback) throw new Error("Expected streamSSE callback");

			const streamTask = callback(stream);
			await streamTask;

			expect(writeCount).toBe(2);
			expect(stream.sleep).not.toHaveBeenCalled();
			expect(unsubscribeCount).toBe(1);
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("absorbs an event write rejection that races a client disconnect", async () => {
		const abortController = new AbortController();
		let eventHandler: undefined | ((data: TestEvents["updated"]) => void | Promise<void>);
		let unsubscribeCount = 0;
		let rejectEventWrite: undefined | ((error: Error) => void);
		let writeCount = 0;
		const unhandledRejections: unknown[] = [];
		const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
		const stream = {
			aborted: false,
			onAbort: vi.fn(),
			sleep: vi.fn(
				() =>
					new Promise<void>((resolve) => {
						abortController.signal.addEventListener("abort", () => resolve(), { once: true });
					}),
			),
			writeSSE: vi.fn(() => {
				writeCount += 1;
				if (writeCount <= 2) return Promise.resolve();

				return new Promise<void>((_resolve, reject) => {
					rejectEventWrite = reject;
				});
			}),
		};
		const context = {
			req: { raw: new Request("http://localhost/events", { signal: abortController.signal }) },
		} as Context;

		process.on("unhandledRejection", onUnhandledRejection);

		try {
			streamEvents<TestEvents, "updated">(context, {
				connectionLabel: "test events",
				events: ["updated"],
				shouldSend: () => true,
				subscribe: (_eventName, handler) => {
					eventHandler = handler;
					return () => {
						unsubscribeCount += 1;
					};
				},
			});

			const callback = streamingMock.callback;
			expect(callback).toBeDefined();
			if (!callback) throw new Error("Expected streamSSE callback");

			const streamTask = callback(stream);
			await waitFor(() => eventHandler !== undefined);

			const handler = eventHandler;
			expect(handler).toBeDefined();
			if (!handler) throw new Error("Expected event handler");

			void handler({ id: "task-1" });
			await waitFor(() => rejectEventWrite !== undefined);

			abortController.abort();
			const abortError = new DOMException("The connection was closed", "AbortError");
			rejectEventWrite?.(abortError);

			await streamTask;
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(unsubscribeCount).toBe(1);
			expect(unhandledRejections).toEqual([]);
		} finally {
			process.off("unhandledRejection", onUnhandledRejection);
		}
	});
});
