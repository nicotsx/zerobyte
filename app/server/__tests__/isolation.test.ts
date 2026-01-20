import { test, describe, expect } from "bun:test";
import { createApp } from "~/server/app";
import { createTestSession } from "~/test/helpers/auth";
import { db } from "~/server/db/db";
import { repositoriesTable, volumesTable, backupSchedulesTable } from "~/server/db/schema";
import crypto from "node:crypto";
import { generateShortId } from "~/server/utils/id";

const app = createApp();

describe("multi-organization isolation", () => {
	test("should not be able to access repositories from another organization", async () => {
		const session1 = await createTestSession();
		const session2 = await createTestSession();

		expect(session1.organizationId).not.toBe(session2.organizationId);

		const repoId = crypto.randomUUID();
		const shortId = generateShortId();
		await db.insert(repositoriesTable).values({
			id: repoId,
			shortId,
			name: "Org 1 Repo",
			type: "local",
			config: { backend: "local", name: "org1repo", path: "/tmp/repo1" },
			organizationId: session1.organizationId,
		});

		const res = await app.request(`/api/v1/repositories/${repoId}`, {
			headers: {
				Cookie: `better-auth.session_token=${session2.token}`,
			},
		});

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.message).toBe("Repository not found");

		const resOk = await app.request(`/api/v1/repositories/${repoId}`, {
			headers: {
				Cookie: `better-auth.session_token=${session1.token}`,
			},
		});
		expect(resOk.status).toBe(200);
	});

	test("should not list repositories from another organization", async () => {
		const session1 = await createTestSession();
		const session2 = await createTestSession();

		await db.insert(repositoriesTable).values({
			id: crypto.randomUUID(),
			shortId: generateShortId(),
			name: "Org 1 Repo",
			type: "local",
			config: { backend: "local", name: "org1repo-list", path: "/tmp/repo1" },
			organizationId: session1.organizationId,
		});

		await db.insert(repositoriesTable).values({
			id: crypto.randomUUID(),
			shortId: generateShortId(),
			name: "Org 2 Repo",
			type: "local",
			config: { backend: "local", name: "org2repo-list", path: "/tmp/repo2" },
			organizationId: session2.organizationId,
		});

		const res1 = await app.request("/api/v1/repositories", {
			headers: {
				Cookie: `better-auth.session_token=${session1.token}`,
			},
		});
		const list1 = await res1.json();

		expect(list1.length).toBeGreaterThanOrEqual(1);
		expect(list1.some((r: any) => r.name === "Org 2 Repo")).toBe(false);

		const res2 = await app.request("/api/v1/repositories", {
			headers: {
				Cookie: `better-auth.session_token=${session2.token}`,
			},
		});
		const list2 = await res2.json();
		expect(list2.some((r: any) => r.name === "Org 1 Repo")).toBe(false);
		expect(list2.some((r: any) => r.name === "Org 2 Repo")).toBe(true);
	});

	test("should not be able to access volumes from another organization", async () => {
		const session1 = await createTestSession();
		const session2 = await createTestSession();

		const volumeId = Math.floor(Math.random() * 1000000);
		await db.insert(volumesTable).values({
			id: volumeId,
			shortId: generateShortId(),
			name: "Org 1 Volume",
			type: "directory",
			config: { backend: "directory", path: "/tmp/vol1" },
			organizationId: session1.organizationId,
			status: "unmounted",
		});

		const res = await app.request(`/api/v1/volumes/${volumeId}`, {
			headers: {
				Cookie: `better-auth.session_token=${session2.token}`,
			},
		});

		expect(res.status).toBe(404);
	});

	test("should not be able to create a backup schedule referencing resources from another organization", async () => {
		const session1 = await createTestSession();
		const session2 = await createTestSession();

		const vol1Id = Math.floor(Math.random() * 1000000);
		await db.insert(volumesTable).values({
			id: vol1Id,
			shortId: generateShortId(),
			name: "Org 1 Volume",
			type: "directory",
			config: { backend: "directory", path: "/tmp/vol1" },
			organizationId: session1.organizationId,
			status: "unmounted",
		});

		const repo1Id = crypto.randomUUID();
		await db.insert(repositoriesTable).values({
			id: repo1Id,
			shortId: generateShortId(),
			name: "Org 1 Repo",
			type: "local",
			config: { backend: "local", name: "org1repo", path: "/tmp/repo1" },
			organizationId: session1.organizationId,
		});

		const res = await app.request("/api/v1/backups", {
			method: "POST",
			headers: {
				Cookie: `better-auth.session_token=${session2.token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				name: "Malicious Schedule",
				volumeId: vol1Id,
				repositoryId: repo1Id,
				enabled: true,
				cronExpression: "0 0 * * *",
			}),
		});

		expect(res.status).toBe(404);
	});

	test("should not be able to access backup schedules from another organization", async () => {
		const session1 = await createTestSession();
		const session2 = await createTestSession();

		const vol1Id = Math.floor(Math.random() * 1000000);
		await db.insert(volumesTable).values({
			id: vol1Id,
			shortId: generateShortId(),
			name: "Org 1 Volume",
			type: "directory",
			config: { backend: "directory", path: "/tmp/vol1" },
			organizationId: session1.organizationId,
			status: "unmounted",
		});
		const repo1Id = crypto.randomUUID();
		await db.insert(repositoriesTable).values({
			id: repo1Id,
			shortId: generateShortId(),
			name: "Org 1 Repo",
			type: "local",
			config: { backend: "local", name: "org1repo", path: "/tmp/repo1" },
			organizationId: session1.organizationId,
		});

		const [schedule] = await db
			.insert(backupSchedulesTable)
			.values({
				shortId: generateShortId(),
				name: "Org 1 Schedule",
				volumeId: vol1Id,
				repositoryId: repo1Id,
				cronExpression: "0 0 * * *",
				organizationId: session1.organizationId,
			})
			.returning();

		const res = await app.request(`/api/v1/backups/${schedule.id}`, {
			headers: {
				Cookie: `better-auth.session_token=${session2.token}`,
			},
		});

		expect(res.status).toBe(404);

		const resOk = await app.request(`/api/v1/backups/${schedule.id}`, {
			headers: {
				Cookie: `better-auth.session_token=${session1.token}`,
			},
		});
		expect(resOk.status).toBe(200);
	});
});
