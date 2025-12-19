import { test, describe, expect } from "bun:test";
import { createApp } from "~/server/app";
import { createTestSession } from "~/test/helpers/auth";

const app = createApp();

describe("events security", () => {
	test("should return 401 if no session cookie is provided", async () => {
		const res = await app.request("/api/v1/events");
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.message).toBe("Authentication required");
	});

	test("should return 401 if session is invalid", async () => {
		const res = await app.request("/api/v1/events", {
			headers: {
				Cookie: "session_id=invalid-session",
			},
		});
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.message).toBe("Invalid or expired session");

		expect(res.headers.get("Set-Cookie")).toContain("session_id=;");
	});

	test("should return 200 if session is valid", async () => {
		const { sessionId } = await createTestSession();

		const res = await app.request("/api/v1/events", {
			headers: {
				Cookie: `session_id=${sessionId}`,
			},
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("text/event-stream");
	});

	describe("unauthenticated access", () => {
		const endpoints: { method: string; path: string }[] = [{ method: "GET", path: "/api/v1/events" }];

		for (const { method, path } of endpoints) {
			test(`${method} ${path} should return 401`, async () => {
				const res = await app.request(path, { method });
				expect(res.status).toBe(401);
				const body = await res.json();
				expect(body.message).toBe("Authentication required");
			});
		}
	});
});
