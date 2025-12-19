import { test, describe, expect } from "bun:test";
import { createApp } from "~/server/app";
import { createTestSession } from "~/test/helpers/auth";

const app = createApp();

describe("repositories security", () => {
	test("should return 401 if no session cookie is provided", async () => {
		const res = await app.request("/api/v1/repositories");
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.message).toBe("Authentication required");
	});

	test("should return 401 if session is invalid", async () => {
		const res = await app.request("/api/v1/repositories", {
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

		const res = await app.request("/api/v1/repositories", {
			headers: {
				Cookie: `session_id=${sessionId}`,
			},
		});

		expect(res.status).toBe(200);
	});

	describe("unauthenticated access", () => {
		const endpoints: { method: string; path: string }[] = [
			{ method: "GET", path: "/api/v1/repositories" },
			{ method: "POST", path: "/api/v1/repositories" },
			{ method: "GET", path: "/api/v1/repositories/rclone-remotes" },
			{ method: "GET", path: "/api/v1/repositories/test-repo" },
			{ method: "DELETE", path: "/api/v1/repositories/test-repo" },
			{ method: "GET", path: "/api/v1/repositories/test-repo/snapshots" },
			{ method: "GET", path: "/api/v1/repositories/test-repo/snapshots/test-snapshot" },
			{ method: "GET", path: "/api/v1/repositories/test-repo/snapshots/test-snapshot/files" },
			{ method: "POST", path: "/api/v1/repositories/test-repo/restore" },
			{ method: "POST", path: "/api/v1/repositories/test-repo/doctor" },
			{ method: "DELETE", path: "/api/v1/repositories/test-repo/snapshots/test-snapshot" },
			{ method: "PATCH", path: "/api/v1/repositories/test-repo" },
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
		test("should not disclose if a repository exists when unauthenticated", async () => {
			const res = await app.request("/api/v1/repositories/non-existent-repo");
			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body.message).toBe("Authentication required");
		});
	});

	describe("input validation", () => {
		test("should return 404 for non-existent repository", async () => {
			const { sessionId } = await createTestSession();
			const res = await app.request("/api/v1/repositories/non-existent-repo", {
				headers: {
					Cookie: `session_id=${sessionId}`,
				},
			});

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.message).toBe("Repository not found");
		});

		test("should return 400 for invalid payload on create", async () => {
			const { sessionId } = await createTestSession();
			const res = await app.request("/api/v1/repositories", {
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
