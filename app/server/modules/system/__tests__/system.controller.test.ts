import { test, describe, expect } from "bun:test";
import { createApp } from "~/server/app";
import { createTestSession, createTestSessionWithGlobalAdmin, getAuthHeaders } from "~/test/helpers/auth";

const app = createApp();

describe("system security", () => {
	test("should return 401 if no session cookie is provided", async () => {
		const res = await app.request("/api/v1/system/info");
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.message).toBe("Invalid or expired session");
	});

	test("should return 401 if session is invalid", async () => {
		const res = await app.request("/api/v1/system/info", {
			headers: getAuthHeaders("invalid-session"),
		});
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.message).toBe("Invalid or expired session");
	});

	test("should return 200 if session is valid", async () => {
		const { headers } = await createTestSession();

		const res = await app.request("/api/v1/system/info", {
			headers,
		});

		expect(res.status).toBe(200);
	});

	describe("unauthenticated access", () => {
		const endpoints: { method: string; path: string }[] = [
			{ method: "GET", path: "/api/v1/system/info" },
			{ method: "GET", path: "/api/v1/system/updates" },
			{ method: "GET", path: "/api/v1/system/registration-status" },
			{ method: "PUT", path: "/api/v1/system/registration-status" },
			{ method: "POST", path: "/api/v1/system/restic-password" },
			{ method: "GET", path: "/api/v1/system/dev-panel" },
		];

		for (const { method, path } of endpoints) {
			test(`${method} ${path} should return 401`, async () => {
				const res = await app.request(path, { method });
				expect(res.status).toBe(401);
				const body = await res.json();
				expect(body.message).toBe("Invalid or expired session");
			});
		}
	});

	describe("registration-status endpoint", () => {
		test("GET /api/v1/system/registration-status should be accessible with valid session", async () => {
			const { headers } = await createTestSession();
			const res = await app.request("/api/v1/system/registration-status", { headers });
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(typeof body.enabled).toBe("boolean");
		});

		test("PUT /api/v1/system/registration-status should return 403 for non-admin users", async () => {
			const { headers } = await createTestSession();
			const res = await app.request("/api/v1/system/registration-status", {
				method: "PUT",
				headers: {
					...headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ enabled: false }),
			});
			expect(res.status).toBe(403);
			const body = await res.json();
			expect(body.message).toBe("Forbidden");
		});

		test("PUT /api/v1/system/registration-status should be accessible to global admin", async () => {
			const { headers } = await createTestSessionWithGlobalAdmin();
			const res = await app.request("/api/v1/system/registration-status", {
				method: "PUT",
				headers: {
					...headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ enabled: false }),
			});
			expect(res.status).toBe(200);
		});
	});

	describe("dev-panel endpoint", () => {
		test("GET /api/v1/system/dev-panel should be accessible with valid session", async () => {
			const { headers } = await createTestSession();
			const res = await app.request("/api/v1/system/dev-panel", { headers });
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(typeof body.enabled).toBe("boolean");
		});
	});

	describe("updates endpoint", () => {
		test("GET /api/v1/system/updates should be accessible with valid session", async () => {
			const { headers } = await createTestSession();
			const res = await app.request("/api/v1/system/updates", { headers });
			expect(res.status).toBe(200);
		});
	});

	describe("input validation", () => {
		test("should return 400 for invalid payload on restic-password", async () => {
			const { headers } = await createTestSession();
			const res = await app.request("/api/v1/system/restic-password", {
				method: "POST",
				headers: {
					...headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({}),
			});

			expect(res.status).toBe(400);
		});

		test("should return 401 for incorrect password on restic-password", async () => {
			const { headers } = await createTestSession();
			const res = await app.request("/api/v1/system/restic-password", {
				method: "POST",
				headers: {
					...headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					password: "wrong-password",
				}),
			});

			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body.message).toBe("Invalid password");
		});
	});
});
