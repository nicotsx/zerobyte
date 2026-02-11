import { test, describe, expect } from "bun:test";
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
		const { token } = await createTestSession();

		const res = await app.request("/api/v1/events", {
			headers: getAuthHeaders(token),
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("text/event-stream");
		await res.body?.cancel();
	});

	test("should cleanup SSE listeners when client disconnects", async () => {
		const { token } = await createTestSession();
		const initialCount = serverEvents.listenerCount("doctor:cancelled");

		const res = await app.request("/api/v1/events", {
			headers: getAuthHeaders(token),
		});

		expect(res.status).toBe(200);

		for (let i = 0; i < 20 && serverEvents.listenerCount("doctor:cancelled") < initialCount + 1; i++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}

		expect(serverEvents.listenerCount("doctor:cancelled")).toBe(initialCount + 1);

		await res.body?.cancel();

		for (let i = 0; i < 20 && serverEvents.listenerCount("doctor:cancelled") > initialCount; i++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}

		expect(serverEvents.listenerCount("doctor:cancelled")).toBe(initialCount);
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
