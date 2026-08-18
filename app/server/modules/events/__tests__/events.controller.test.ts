import { describe, expect, test } from "vitest";
import { createApp } from "~/server/app";
import { serverEvents } from "~/server/core/events";
import { createTestSession, getAuthHeaders } from "~/test/helpers/auth";

const app = createApp();

describe("events security", () => {
	test("should return 401 if no session cookie is provided", async () => {
		const res = await app.request("/api/v1/events");
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.message).toBe("Invalid or expired session");
	});

	test("should return 401 if session is invalid", async () => {
		const res = await app.request("/api/v1/events", {
			headers: getAuthHeaders("invalid-session"),
		});
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.message).toBe("Invalid or expired session");
	});

	test("should return 200 if session is valid", async () => {
		const { headers } = await createTestSession();

		const res = await app.request("/api/v1/events", {
			headers,
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("text/event-stream");
		await res.body?.cancel();
	});

	test("should cleanup SSE listeners when client disconnects", async () => {
		const { headers } = await createTestSession();
		const initialCount = serverEvents.listenerCount("task:history-changed");

		const res = await app.request("/api/v1/events", {
			headers,
		});

		expect(res.status).toBe(200);

		for (let i = 0; i < 20 && serverEvents.listenerCount("task:history-changed") < initialCount + 1; i++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}

		expect(serverEvents.listenerCount("task:history-changed")).toBe(initialCount + 1);

		await res.body?.cancel();

		for (let i = 0; i < 20 && serverEvents.listenerCount("task:history-changed") > initialCount; i++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}

		expect(serverEvents.listenerCount("task:history-changed")).toBe(initialCount);
	});

	test("should cleanup SSE listeners when the request is aborted", async () => {
		const { headers } = await createTestSession();
		const abortController = new AbortController();
		const initialCount = serverEvents.listenerCount("task:history-changed");

		const res = await app.request("/api/v1/events", {
			headers,
			signal: abortController.signal,
		});

		try {
			expect(res.status).toBe(200);

			for (let i = 0; i < 20 && serverEvents.listenerCount("task:history-changed") < initialCount + 1; i++) {
				await new Promise((resolve) => setTimeout(resolve, 10));
			}

			expect(serverEvents.listenerCount("task:history-changed")).toBe(initialCount + 1);

			abortController.abort();

			for (let i = 0; i < 20 && serverEvents.listenerCount("task:history-changed") > initialCount; i++) {
				await new Promise((resolve) => setTimeout(resolve, 10));
			}

			expect(serverEvents.listenerCount("task:history-changed")).toBe(initialCount);
		} finally {
			await res.body?.cancel();
		}
	});

	describe("unauthenticated access", () => {
		const endpoints: { method: string; path: string }[] = [{ method: "GET", path: "/api/v1/events" }];

		for (const { method, path } of endpoints) {
			test(`${method} ${path} should return 401`, async () => {
				const res = await app.request(path, { method });
				expect(res.status).toBe(401);
				const body = await res.json();
				expect(body.message).toBe("Invalid or expired session");
			});
		}
	});
});
