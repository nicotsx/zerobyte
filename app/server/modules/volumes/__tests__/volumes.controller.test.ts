import { test, describe, expect } from "bun:test";
import { createApp } from "~/server/app";
import { createTestSession } from "~/test/helpers/auth";

const app = createApp();

describe("volumes security", () => {
	test("should return 401 if no session cookie is provided", async () => {
		const res = await app.request("/api/v1/volumes");
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.message).toBe("Invalid or expired session");
	});

	test("should return 401 if session is invalid", async () => {
		const res = await app.request("/api/v1/volumes", {
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

		const res = await app.request("/api/v1/volumes", {
			headers: {
				Cookie: `better-auth.session_token=${token}`,
			},
		});

		expect(res.status).toBe(200);
	});

	describe("unauthenticated access", () => {
		const endpoints: { method: string; path: string }[] = [
			{ method: "GET", path: "/api/v1/volumes" },
			{ method: "POST", path: "/api/v1/volumes" },
			{ method: "POST", path: "/api/v1/volumes/test-connection" },
			{ method: "DELETE", path: "/api/v1/volumes/test-volume" },
			{ method: "GET", path: "/api/v1/volumes/test-volume" },
			{ method: "PUT", path: "/api/v1/volumes/test-volume" },
			{ method: "POST", path: "/api/v1/volumes/test-volume/mount" },
			{ method: "POST", path: "/api/v1/volumes/test-volume/unmount" },
			{ method: "POST", path: "/api/v1/volumes/test-volume/health-check" },
			{ method: "GET", path: "/api/v1/volumes/test-volume/files" },
			{ method: "GET", path: "/api/v1/volumes/filesystem/browse" },
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
		test("should not disclose if a volume exists when unauthenticated", async () => {
			const res = await app.request("/api/v1/volumes/non-existent-volume");
			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body.message).toBe("Invalid or expired session");
		});
	});

	describe("input validation", () => {
		test("should return 404 for non-existent volume", async () => {
			const { token } = await createTestSession();
			const res = await app.request("/api/v1/volumes/non-existent-volume", {
				headers: {
					Cookie: `better-auth.session_token=${token}`,
				},
			});

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.message).toBe("Volume not found");
		});

		test("should return 400 for invalid payload on create", async () => {
			const { token } = await createTestSession();
			const res = await app.request("/api/v1/volumes", {
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
