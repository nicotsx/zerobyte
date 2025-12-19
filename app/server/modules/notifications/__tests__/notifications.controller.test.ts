import { test, describe, expect } from "bun:test";
import { createApp } from "~/server/app";
import { createTestSession } from "~/test/helpers/auth";

const app = createApp();

describe("notifications security", () => {
	test("should return 401 if no session cookie is provided", async () => {
		const res = await app.request("/api/v1/notifications/destinations");
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.message).toBe("Authentication required");
	});

	test("should return 401 if session is invalid", async () => {
		const res = await app.request("/api/v1/notifications/destinations", {
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

		const res = await app.request("/api/v1/notifications/destinations", {
			headers: {
				Cookie: `session_id=${sessionId}`,
			},
		});

		expect(res.status).toBe(200);
	});

	describe("unauthenticated access", () => {
		const endpoints: { method: string; path: string }[] = [
			{ method: "GET", path: "/api/v1/notifications/destinations" },
			{ method: "POST", path: "/api/v1/notifications/destinations" },
			{ method: "GET", path: "/api/v1/notifications/destinations/1" },
			{ method: "PATCH", path: "/api/v1/notifications/destinations/1" },
			{ method: "DELETE", path: "/api/v1/notifications/destinations/1" },
			{ method: "POST", path: "/api/v1/notifications/destinations/1/test" },
		];

		for (const { method, path } of endpoints) {
			test(`${method} ${path} should return 401`, async () => {
				const res = await app.request(path, { method });
				expect(res.status).toBe(401);
				const body = await res.json();
				expect(body.message).toBe("Authentication required");
			});
		}
	});

	describe("information disclosure", () => {
		test("should not disclose if a destination exists when unauthenticated", async () => {
			const res = await app.request("/api/v1/notifications/destinations/999999");
			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body.message).toBe("Authentication required");
		});
	});

	describe("input validation", () => {
		test("should return 404 for malformed destination ID", async () => {
			const { sessionId } = await createTestSession();
			const res = await app.request("/api/v1/notifications/destinations/not-a-number", {
				headers: {
					Cookie: `session_id=${sessionId}`,
				},
			});

			expect(res.status).toBe(404);
		});

		test("should return 404 for non-existent destination ID", async () => {
			const { sessionId } = await createTestSession();
			const res = await app.request("/api/v1/notifications/destinations/999999", {
				headers: {
					Cookie: `session_id=${sessionId}`,
				},
			});

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.message).toBe("Notification destination not found");
		});

		test("should return 400 for invalid payload on create", async () => {
			const { sessionId } = await createTestSession();
			const res = await app.request("/api/v1/notifications/destinations", {
				method: "POST",
				headers: {
					Cookie: `session_id=${sessionId}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					name: "Test",
				}),
			});

			expect(res.status).toBe(400);
		});
	});
});
