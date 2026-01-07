import { test, describe, expect } from "bun:test";
import { createApp } from "~/server/app";
import { createTestSession } from "~/test/helpers/auth";

const app = createApp();

describe("backups security", () => {
	test("should return 401 if no session cookie is provided", async () => {
		const res = await app.request("/api/v1/backups");
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.message).toBe("Invalid or expired session");
	});

	test("should return 401 if session is invalid", async () => {
		const res = await app.request("/api/v1/backups", {
			headers: {
				Cookie: "better-auth.session_token=invalid-session",
			},
		});
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.message).toBe("Invalid or expired session");
	});

	test("should return 200 if session is valid", async () => {
		const { token } = await createTestSession();

		const res = await app.request("/api/v1/backups", {
			headers: {
				Cookie: `better-auth.session_token=${token}`,
			},
		});

		expect(res.status).toBe(200);
	});

	describe("unauthenticated access", () => {
		const endpoints: { method: string; path: string }[] = [
			{ method: "GET", path: "/api/v1/backups" },
			{ method: "GET", path: "/api/v1/backups/1" },
			{ method: "GET", path: "/api/v1/backups/volume/1" },
			{ method: "POST", path: "/api/v1/backups" },
			{ method: "PATCH", path: "/api/v1/backups/1" },
			{ method: "DELETE", path: "/api/v1/backups/1" },
			{ method: "POST", path: "/api/v1/backups/1/run" },
			{ method: "POST", path: "/api/v1/backups/1/stop" },
			{ method: "POST", path: "/api/v1/backups/1/forget" },
			{ method: "GET", path: "/api/v1/backups/1/notifications" },
			{ method: "PUT", path: "/api/v1/backups/1/notifications" },
			{ method: "GET", path: "/api/v1/backups/1/mirrors" },
			{ method: "PUT", path: "/api/v1/backups/1/mirrors" },
			{ method: "GET", path: "/api/v1/backups/1/mirrors/compatibility" },
			{ method: "POST", path: "/api/v1/backups/reorder" },
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

	describe("information disclosure", () => {
		test("should not disclose if a schedule exists when unauthenticated", async () => {
			const res = await app.request("/api/v1/backups/999999");
			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body.message).toBe("Invalid or expired session");
		});

		test("should not disclose if a volume exists when unauthenticated", async () => {
			const res = await app.request("/api/v1/backups/volume/999999");
			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body.message).toBe("Invalid or expired session");
		});
	});

	describe("input validation", () => {
		test("should return 404 for malformed schedule ID", async () => {
			const { token } = await createTestSession();
			const res = await app.request("/api/v1/backups/not-a-number", {
				headers: {
					Cookie: `better-auth.session_token=${token}`,
				},
			});

			expect(res.status).toBe(404);
		});

		test("should return 404 for non-existent schedule ID", async () => {
			const { token } = await createTestSession();
			const res = await app.request("/api/v1/backups/999999", {
				headers: {
					Cookie: `better-auth.session_token=${token}`,
				},
			});

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.message).toBe("Backup schedule not found");
		});

		test("should return 400 for invalid payload on create", async () => {
			const { token } = await createTestSession();
			const res = await app.request("/api/v1/backups", {
				method: "POST",
				headers: {
					Cookie: `better-auth.session_token=${token}`,
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
