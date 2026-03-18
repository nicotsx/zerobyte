import { test, describe, expect } from "bun:test";
import { createApp } from "~/server/app";
import { createTestSession, getAuthHeaders } from "~/test/helpers/auth";
import { createTestVolume } from "~/test/helpers/volume";
import { createTestRepository } from "~/test/helpers/repository";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { cache, cacheKeys } from "~/server/utils/cache";

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
			headers: getAuthHeaders("invalid-session"),
		});
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.message).toBe("Invalid or expired session");
	});

	test("should return 200 if session is valid", async () => {
		const { headers } = await createTestSession();

		const res = await app.request("/api/v1/backups", {
			headers,
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
			{ method: "GET", path: "/api/v1/backups/1/progress" },
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
		test("should return cached progress for a running backup", async () => {
			const { headers, organizationId } = await createTestSession();
			const volume = await createTestVolume({ organizationId });
			const repository = await createTestRepository({ organizationId });
			const schedule = await createTestBackupSchedule({
				organizationId,
				volumeId: volume.id,
				repositoryId: repository.id,
			});

			cache.set(cacheKeys.backup.progress(schedule.id), {
				scheduleId: schedule.shortId,
				volumeName: volume.name,
				repositoryName: repository.name,
				message_type: "status",
				seconds_elapsed: 12,
				seconds_remaining: 24,
				percent_done: 0.5,
				total_files: 100,
				files_done: 50,
				total_bytes: 1024,
				bytes_done: 512,
				current_files: ["/mnt/data/file.txt"],
			});

			const res = await app.request(`/api/v1/backups/${schedule.shortId}/progress`, {
				headers,
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toMatchObject({
				scheduleId: schedule.shortId,
				percent_done: 0.5,
				files_done: 50,
				current_files: ["/mnt/data/file.txt"],
			});

			cache.del(cacheKeys.backup.progress(schedule.id));
		});

		test("should return a schedule when queried by short id", async () => {
			const { headers, organizationId } = await createTestSession();
			const volume = await createTestVolume({ organizationId });
			const repository = await createTestRepository({ organizationId });
			const schedule = await createTestBackupSchedule({
				organizationId,
				volumeId: volume.id,
				repositoryId: repository.id,
			});

			const res = await app.request(`/api/v1/backups/${schedule.shortId}`, {
				headers,
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.id).toBe(schedule.id);
			expect(body.shortId).toBe(schedule.shortId);
		});

		test("should return 404 for malformed schedule ID", async () => {
			const { headers } = await createTestSession();
			const res = await app.request("/api/v1/backups/not-a-number", {
				headers,
			});

			expect(res.status).toBe(404);
		});

		test("should return 404 for non-existent schedule ID", async () => {
			const { headers } = await createTestSession();
			const res = await app.request("/api/v1/backups/999999", {
				headers,
			});

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.message).toBe("Backup schedule not found");
		});

		test("should return 400 for invalid payload on create", async () => {
			const { headers } = await createTestSession();
			const res = await app.request("/api/v1/backups", {
				method: "POST",
				headers: {
					...headers,
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
