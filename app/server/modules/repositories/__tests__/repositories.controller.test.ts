import { test, describe, expect } from "bun:test";
import crypto from "node:crypto";
import { createApp } from "~/server/app";
import { db } from "~/server/db/db";
import { repositoriesTable } from "~/server/db/schema";
import { generateShortId } from "~/server/utils/id";
import { createTestSession, getAuthHeaders } from "~/test/helpers/auth";
import type { RepositoryConfig } from "~/schemas/restic";

const app = createApp();

const createRepositoryRecord = async (organizationId: string) => {
	const [repository] = await db
		.insert(repositoriesTable)
		.values({
			id: crypto.randomUUID(),
			shortId: generateShortId(),
			name: `Repository-${crypto.randomUUID()}`,
			type: "local",
			config: {
				backend: "local",
				name: generateShortId(),
				path: `/tmp/repository-${crypto.randomUUID()}`,
				isExistingRepository: true,
			},
			compressionMode: "off",
			status: "error",
			lastChecked: Date.now(),
			lastError: "old error",
			doctorResult: {
				success: false,
				steps: [],
				completedAt: Date.now(),
			},
			organizationId,
		})
		.returning();

	return repository;
};

describe("repositories security", () => {
	test("should return 401 if no session cookie is provided", async () => {
		const res = await app.request("/api/v1/repositories");
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.message).toBe("Invalid or expired session");
	});

	test("should return 401 if session is invalid", async () => {
		const res = await app.request("/api/v1/repositories", {
			headers: getAuthHeaders("invalid-session"),
		});
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.message).toBe("Invalid or expired session");
	});

	test("should return 200 if session is valid", async () => {
		const { token } = await createTestSession();

		const res = await app.request("/api/v1/repositories", {
			headers: getAuthHeaders(token),
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
			{ method: "DELETE", path: "/api/v1/repositories/test-repo/snapshots" },
			{ method: "PATCH", path: "/api/v1/repositories/test-repo" },
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
		test("should not disclose if a repository exists when unauthenticated", async () => {
			const res = await app.request("/api/v1/repositories/non-existent-repo");
			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body.message).toBe("Invalid or expired session");
		});
	});

	describe("input validation", () => {
		test("should return 404 for non-existent repository", async () => {
			const { token } = await createTestSession();
			const res = await app.request("/api/v1/repositories/non-existent-repo", {
				headers: getAuthHeaders(token),
			});

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.message).toBe("Repository not found");
		});

		test("should return 400 for invalid payload on create", async () => {
			const { token } = await createTestSession();
			const res = await app.request("/api/v1/repositories", {
				method: "POST",
				headers: {
					...getAuthHeaders(token),
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

describe("repositories updates", () => {
	test("PATCH updates full config and metadata using shortId", async () => {
		const { token, organizationId } = await createTestSession();
		const repository = await createRepositoryRecord(organizationId);
		const nextPath = `/tmp/updated-${crypto.randomUUID()}`;

		const res = await app.request(`/api/v1/repositories/${repository.shortId}`, {
			method: "PATCH",
			headers: {
				...getAuthHeaders(token),
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				name: "Updated repository",
				compressionMode: "max",
				config: {
					backend: "local",
					path: nextPath,
					isExistingRepository: true,
				},
			}),
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.name).toBe("Updated repository");
		expect(body.compressionMode).toBe("max");
		expect(body.config.backend).toBe("local");
		expect(body.config.path).toBe(nextPath);
		expect(body.status).toBe("unknown");
		expect(body.lastChecked).toBeNull();
		expect(body.lastError).toBeNull();
		expect(body.doctorResult).toBeNull();

		const updated = await db.query.repositoriesTable.findFirst({
			where: { id: repository.id },
		});

		const config = updated?.config as Extract<RepositoryConfig, { backend: "local" }>;

		expect(updated).toBeTruthy();
		expect(updated?.name).toBe("Updated repository");
		expect(updated?.compressionMode).toBe("max");
		expect(config.path).toBe(nextPath);
		expect(updated?.status).toBe("unknown");
		expect(updated?.lastChecked).toBeNull();
		expect(updated?.lastError).toBeNull();
		expect(updated?.doctorResult).toBeNull();
	});

	test("PATCH rejects backend changes", async () => {
		const { token, organizationId } = await createTestSession();
		const repository = await createRepositoryRecord(organizationId);

		const res = await app.request(`/api/v1/repositories/${repository.id}`, {
			method: "PATCH",
			headers: {
				...getAuthHeaders(token),
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				config: {
					backend: "s3",
					endpoint: "s3.amazonaws.com",
					bucket: "bucket-name",
					accessKeyId: "access-key",
					secretAccessKey: "secret-key",
				},
			}),
		});

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.message).toBe("Repository backend cannot be changed");
	});

	test("PATCH rejects invalid config payload", async () => {
		const { token, organizationId } = await createTestSession();
		const repository = await createRepositoryRecord(organizationId);

		const res = await app.request(`/api/v1/repositories/${repository.id}`, {
			method: "PATCH",
			headers: {
				...getAuthHeaders(token),
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				config: {
					backend: "local",
				},
			}),
		});

		expect(res.status).toBe(400);
	});
});
