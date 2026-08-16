import { beforeAll, describe, expect, test } from "vitest";
import { createApp } from "~/server/app";
import { createTestSession, getAuthHeaders } from "~/test/helpers/auth";
import { createTestVolume } from "~/test/helpers/volume";
import { createTestRepository } from "~/test/helpers/repository";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { repoMutex } from "~/server/core/repository-mutex";
import { requestTaskCancel } from "~/server/modules/tasks/tasks.lifecycle";
import { taskStore } from "~/server/modules/tasks/tasks.store";
import waitForExpect from "wait-for-expect";

const app = createApp();

let session: Awaited<ReturnType<typeof createTestSession>>;

beforeAll(async () => {
	session = await createTestSession();
});

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
		const res = await app.request("/api/v1/backups", {
			headers: session.headers,
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
			{ method: "POST", path: "/api/v1/backups/1/forget" },
			{ method: "GET", path: "/api/v1/backups/1/notifications" },
			{ method: "PUT", path: "/api/v1/backups/1/notifications" },
			{ method: "GET", path: "/api/v1/backups/1/mirrors" },
			{ method: "PUT", path: "/api/v1/backups/1/mirrors" },
			{ method: "GET", path: "/api/v1/backups/1/mirrors/compatibility" },
			{ method: "GET", path: "/api/v1/backups/1/mirrors/abc/status" },
			{ method: "POST", path: "/api/v1/backups/1/mirrors/abc/sync" },
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
		test("should return 409 when a backup is already running for the schedule", async () => {
			const volume = await createTestVolume({ organizationId: session.organizationId });
			const repository = await createTestRepository({ organizationId: session.organizationId });
			const schedule = await createTestBackupSchedule({
				organizationId: session.organizationId,
				volumeId: volume.id,
				repositoryId: repository.id,
			});
			taskStore.create({
				organizationId: session.organizationId,
				resourceType: "backup_schedule",
				resourceId: schedule.shortId,
				targetDisplayName: schedule.name,
				targetAgentId: volume.agentId,
				input: {
					kind: "backup",
					scheduleId: schedule.id,
					scheduleShortId: schedule.shortId,
					manual: true,
				},
			});

			const res = await app.request(`/api/v1/backups/${schedule.shortId}/run`, {
				method: "POST",
				headers: session.headers,
			});

			expect(res.status).toBe(409);
			const body = await res.json();
			expect(body.message).toBe("Backup is already running for this schedule");
		});

		test("should return a schedule when queried by short id", async () => {
			const volume = await createTestVolume({ organizationId: session.organizationId });
			const repository = await createTestRepository({ organizationId: session.organizationId });
			const schedule = await createTestBackupSchedule({
				organizationId: session.organizationId,
				volumeId: volume.id,
				repositoryId: repository.id,
			});

			const res = await app.request(`/api/v1/backups/${schedule.shortId}`, {
				headers: session.headers,
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.id).toBe(schedule.id);
			expect(body.shortId).toBe(schedule.shortId);
		});

		test("should return 404 for malformed schedule ID", async () => {
			const res = await app.request("/api/v1/backups/not-a-number", {
				headers: session.headers,
			});

			expect(res.status).toBe(404);
		});

		test("should return 404 for non-existent schedule ID", async () => {
			const res = await app.request("/api/v1/backups/999999", {
				headers: session.headers,
			});

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.message).toBe("Backup schedule not found");
		});

		test("should return 400 for invalid payload on create", async () => {
			const res = await app.request("/api/v1/backups", {
				method: "POST",
				headers: {
					...session.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					name: "Test",
				}),
			});

			expect(res.status).toBe(400);
		});
	});

	describe("retention policy", () => {
		test("starts a retention task and rejects a duplicate active request", async () => {
			const volume = await createTestVolume({ organizationId: session.organizationId });
			const repository = await createTestRepository({ organizationId: session.organizationId });
			const schedule = await createTestBackupSchedule({
				organizationId: session.organizationId,
				volumeId: volume.id,
				repositoryId: repository.id,
				retentionPolicy: { keepDaily: 7 },
			});
			const forgetPath = `/api/v1/backups/${schedule.shortId}/forget`;
			const releaseLock = await repoMutex.acquireExclusive(repository.id, "controller-retention-task");

			try {
				const firstResponse = await app.request(forgetPath, {
					method: "POST",
					headers: session.headers,
				});
				expect(firstResponse.status).toBe(202);
				const firstBody = await firstResponse.json();
				expect(firstBody).toEqual({ taskId: expect.any(String), status: "started" });

				await waitForExpect(() => {
					const task = taskStore.findById({
						organizationId: session.organizationId,
						taskId: firstBody.taskId,
					});
					expect(task?.status).toBe("queued");
				});

				const duplicateResponse = await app.request(forgetPath, {
					method: "POST",
					headers: session.headers,
				});
				expect(duplicateResponse.status).toBe(409);

				expect(requestTaskCancel(firstBody.taskId)).toBe(true);
			} finally {
				releaseLock();
			}
		});
	});
});
