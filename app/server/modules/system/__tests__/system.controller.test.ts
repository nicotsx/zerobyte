import { test, describe, expect } from "bun:test";
import { createApp } from "~/server/app";
import { createTestSession } from "~/test/helpers/auth";

const app = createApp();

describe("system security", () => {
	test("should return 401 if no session cookie is provided", async () => {
		const res = await app.request("/api/v1/system/info");
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.message).toBe("Authentication required");
	});

	test("should return 401 if session is invalid", async () => {
		const res = await app.request("/api/v1/system/info", {
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

		const res = await app.request("/api/v1/system/info", {
			headers: {
				Cookie: `session_id=${sessionId}`,
			},
		});

		expect(res.status).toBe(200);
	});

	describe("unauthenticated access", () => {
		const endpoints: { method: string; path: string }[] = [
			{ method: "GET", path: "/api/v1/system/info" },
			{ method: "POST", path: "/api/v1/system/restic-password" },
			{ method: "POST", path: "/api/v1/system/export" },
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

	describe("input validation", () => {
		test("should return 400 for invalid payload on restic-password", async () => {
			const { sessionId } = await createTestSession();
			const res = await app.request("/api/v1/system/restic-password", {
				method: "POST",
				headers: {
					Cookie: `session_id=${sessionId}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({}),
			});

			expect(res.status).toBe(400);
		});

		test("should return 401 for incorrect password on restic-password", async () => {
			const { sessionId } = await createTestSession();
			const res = await app.request("/api/v1/system/restic-password", {
				method: "POST",
				headers: {
					Cookie: `session_id=${sessionId}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					password: "wrong-password",
				}),
			});

			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body.message).toBe("Incorrect password");
		});
	});

	test("should return 400 for invalid payload on full export", async () => {
		const { sessionId } = await createTestSession();
		const res = await app.request("/api/v1/system/export", {
			method: "POST",
			headers: {
				Cookie: `session_id=${sessionId}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({}),
		});

		expect(res.status).toBe(400);
	});

	test("should return 401 for incorrect password on full export", async () => {
		const { sessionId } = await createTestSession();
		const res = await app.request("/api/v1/system/export", {
			method: "POST",
			headers: {
				Cookie: `session_id=${sessionId}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				includeMetadata: true,
				password: "wrong-password",
			}),
		});

		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.message).toBe("Incorrect password");
	});

	test("full export never exposes password hashes", async () => {
		const { sessionId } = await createTestSession();

		const res = await app.request("/api/v1/system/export", {
			method: "POST",
			headers: {
				Cookie: `session_id=${sessionId}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				includeMetadata: true,
				password: "testpassword",
			}),
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as { users?: Array<Record<string, unknown>> };
		expect(Array.isArray(body.users)).toBe(true);
		for (const user of body.users ?? []) {
			expect(user.passwordHash).toBeUndefined();
		}
	});
});
