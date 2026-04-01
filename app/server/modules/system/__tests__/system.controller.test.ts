import { beforeAll, describe, expect, test, vi } from "vitest";
import { createApp } from "~/server/app";
import { createTestSession, createTestSessionWithGlobalAdmin, getAuthHeaders } from "~/test/helpers/auth";
import { systemService } from "../system.service";
import * as authHelpers from "~/server/modules/auth/helpers";

const app = createApp();

let session: Awaited<ReturnType<typeof createTestSession>>;
let globalAdminSession: Awaited<ReturnType<typeof createTestSessionWithGlobalAdmin>>;

beforeAll(async () => {
	session = await createTestSession();
	globalAdminSession = await createTestSessionWithGlobalAdmin();
});

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
		const res = await app.request("/api/v1/system/info", {
			headers: session.headers,
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
			const res = await app.request("/api/v1/system/registration-status", { headers: session.headers });
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(typeof body.enabled).toBe("boolean");
		});

		test("PUT /api/v1/system/registration-status should return 403 for non-admin users", async () => {
			const res = await app.request("/api/v1/system/registration-status", {
				method: "PUT",
				headers: {
					...session.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ enabled: false }),
			});
			expect(res.status).toBe(403);
			const body = await res.json();
			expect(body.message).toBe("Forbidden");
		});

		test("PUT /api/v1/system/registration-status should be accessible to global admin", async () => {
			const res = await app.request("/api/v1/system/registration-status", {
				method: "PUT",
				headers: {
					...globalAdminSession.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ enabled: false }),
			});
			expect(res.status).toBe(200);
		});
	});

	describe("dev-panel endpoint", () => {
		test("GET /api/v1/system/dev-panel should be accessible with valid session", async () => {
			const res = await app.request("/api/v1/system/dev-panel", { headers: session.headers });
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(typeof body.enabled).toBe("boolean");
		});
	});

	describe("updates endpoint", () => {
		test("GET /api/v1/system/updates should be accessible with valid session", async () => {
			vi.spyOn(systemService, "getUpdates").mockResolvedValue({
				currentVersion: "1.0.0",
				latestVersion: "1.0.0",
				hasUpdate: false,
				missedReleases: [],
			});

			const res = await app.request("/api/v1/system/updates", { headers: session.headers });
			expect(res.status).toBe(200);
		});
	});

	describe("input validation", () => {
		test("should return 400 for invalid payload on restic-password", async () => {
			const res = await app.request("/api/v1/system/restic-password", {
				method: "POST",
				headers: {
					...session.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({}),
			});

			expect(res.status).toBe(400);
		});

		test("should return 401 for incorrect password on restic-password", async () => {
			vi.spyOn(authHelpers, "verifyUserPassword").mockResolvedValue(false);

			const res = await app.request("/api/v1/system/restic-password", {
				method: "POST",
				headers: {
					...session.headers,
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
