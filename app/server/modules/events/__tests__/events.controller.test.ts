import { describe, expect, test } from "vitest";
import { createApp } from "~/server/app";
import { serverEvents } from "~/server/core/events";
import { createTestSession, getAuthHeaders } from "~/test/helpers/auth";
import { db } from "~/server/db/db";
import { sessionsTable } from "~/server/db/schema";
import { eq } from "drizzle-orm";

const app = createApp();

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

	test("closes and unsubscribes an existing stream when its session ends", async () => {
		const session = await createTestSession();
		const initialCount = serverEvents.listenerCount("volume:updated");
		const response = await app.request("/api/v1/events", { headers: session.headers });
		const reader = response.body!.getReader();

		try {
			await readUntil(reader, "event: connected");
			expect(serverEvents.listenerCount("volume:updated")).toBe(initialCount + 1);

			await db.delete(sessionsTable).where(eq(sessionsTable.userId, session.user.id));
			serverEvents.emit("volume:updated", {
				organizationId: session.organizationId,
				volumeName: "revoked-volume",
			});

			const streamText = await readUntil(reader, "revoked-volume");
			expect(streamText).not.toContain("revoked-volume");
			await expect(reader.read()).resolves.toMatchObject({ done: true });
			expect(serverEvents.listenerCount("volume:updated")).toBe(initialCount);
		} finally {
			void reader.cancel();
			reader.releaseLock();
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
