import { test, describe, expect } from "bun:test";
import { createApp } from "~/server/app";
import { createTestSession, getAuthHeaders } from "~/test/helpers/auth";

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
		const { token } = await createTestSession();

		const res = await app.request("/api/v1/system/info", {
			headers: getAuthHeaders(token),
		});

		expect(res.status).toBe(200);
	});

	describe("unauthenticated access", () => {
		const endpoints: { method: string; path: string }[] = [
			{ method: "GET", path: "/api/v1/system/info" },
			{ method: "POST", path: "/api/v1/system/restic-password" },
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

	describe("input validation", () => {
		test("should return 400 for invalid payload on restic-password", async () => {
			const { token } = await createTestSession();
			const res = await app.request("/api/v1/system/restic-password", {
				method: "POST",
				headers: {
					...getAuthHeaders(token),
					"Content-Type": "application/json",
				},
				body: JSON.stringify({}),
			});

			expect(res.status).toBe(400);
		});

		test("should return 401 for incorrect password on restic-password", async () => {
			const { token } = await createTestSession();
			const res = await app.request("/api/v1/system/restic-password", {
				method: "POST",
				headers: {
					...getAuthHeaders(token),
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
