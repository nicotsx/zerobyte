import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "~/server/app";
import { createTestSession } from "~/test/helpers/auth";
import { db } from "~/server/db/db";
import {
	repositoriesTable,
	volumesTable,
	backupSchedulesTable,
	sessionsTable,
	organization,
	notificationDestinationsTable,
	backupScheduleNotificationsTable,
} from "~/server/db/schema";
import crypto from "node:crypto";
import { generateShortId } from "~/server/utils/id";
import { eq } from "drizzle-orm";

const app = createApp();

describe("multi-organization isolation", () => {
	let session1: Awaited<ReturnType<typeof createTestSession>>;
	let session2: Awaited<ReturnType<typeof createTestSession>>;

	beforeAll(async () => {
		session1 = await createTestSession();
		session2 = await createTestSession();
	});

	beforeEach(async () => {
		await db.delete(backupScheduleNotificationsTable);
		await db.delete(notificationDestinationsTable);
		await db.delete(backupSchedulesTable);
		await db.delete(volumesTable);
		await db.delete(repositoriesTable);

		await db
			.update(sessionsTable)
			.set({ activeOrganizationId: session1.organizationId })
			.where(eq(sessionsTable.id, session1.session.id));

		await db
			.update(sessionsTable)
			.set({ activeOrganizationId: session2.organizationId })
			.where(eq(sessionsTable.id, session2.session.id));
	});

	test("should reject requests when session active organization is not a membership", async () => {
		// Create a different organization the user is NOT a member of
		const foreignOrgId = crypto.randomUUID();
		await db.insert(organization).values({
			id: foreignOrgId,
			name: `Org ${foreignOrgId}`,
			slug: `test-org-${foreignOrgId}`,
			createdAt: new Date(),
		});
		await db.insert(repositoriesTable).values({
			id: crypto.randomUUID(),
			shortId: generateShortId(),
			name: "Foreign Repo",
			type: "local",
			config: { backend: "local", name: "foreign", path: "/tmp/repo-foreign" },
			organizationId: foreignOrgId,
		});

		// Force the session to point at the foreign organization
		await db
			.update(sessionsTable)
			.set({ activeOrganizationId: foreignOrgId })
			.where(eq(sessionsTable.id, session1.session.id));

		const res = await app.request("/api/v1/repositories", {
			headers: session1.headers,
		});

		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.message).toBe("Invalid organization context");
	});

	test("should not be able to access repositories from another organization", async () => {
		expect(session1.organizationId).not.toBe(session2.organizationId);

		const repoId = crypto.randomUUID();
		const repoShortId = generateShortId();
		await db.insert(repositoriesTable).values({
			id: repoId,
			shortId: repoShortId,
			name: "Org 1 Repo",
			type: "local",
			config: { backend: "local", name: "org1repo", path: "/tmp/repo1" },
			organizationId: session1.organizationId,
		});

		const res = await app.request(`/api/v1/repositories/${repoShortId}`, {
			headers: session2.headers,
		});

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.message).toBe("Repository not found");

		const resOk = await app.request(`/api/v1/repositories/${repoShortId}`, {
			headers: session1.headers,
		});
		expect(resOk.status).toBe(200);
	});

	test("should not list repositories from another organization", async () => {
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
			headers: session1.headers,
		});
		const list1 = await res1.json();

		expect(list1.length).toBeGreaterThanOrEqual(1);
		expect(list1.some((r: { name: string }) => r.name === "Org 2 Repo")).toBe(false);

		const res2 = await app.request("/api/v1/repositories", {
			headers: session2.headers,
		});
		const list2 = await res2.json();
		expect(list2.some((r: { name: string }) => r.name === "Org 1 Repo")).toBe(false);
		expect(list2.some((r: { name: string }) => r.name === "Org 2 Repo")).toBe(true);
	});

	test("should not be able to access volumes from another organization", async () => {
		const volumeId = Math.floor(Math.random() * 1000000);
		const volumeShortId = generateShortId();
		await db.insert(volumesTable).values({
			id: volumeId,
			shortId: volumeShortId,
			name: "Org 1 Volume",
			type: "directory",
			config: { backend: "directory", path: "/tmp/vol1" },
			organizationId: session1.organizationId,
			status: "unmounted",
		});

		const res = await app.request(`/api/v1/volumes/${volumeShortId}`, {
			headers: session2.headers,
		});

		expect(res.status).toBe(404);
	});

	test("should not be able to create a backup schedule referencing resources from another organization", async () => {
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
				...session2.headers,
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

		const res = await app.request(`/api/v1/backups/${schedule.shortId}`, {
			headers: session2.headers,
		});

		expect(res.status).toBe(404);

		const resOk = await app.request(`/api/v1/backups/${schedule.shortId}`, {
			headers: session1.headers,
		});
		expect(resOk.status).toBe(200);
	});

	test("should not be able to access or modify notifications for another organization's schedule", async () => {
		const volId = Math.floor(Math.random() * 1000000);
		await db.insert(volumesTable).values({
			id: volId,
			shortId: generateShortId(),
			name: "Org 1 Volume",
			type: "directory",
			config: { backend: "directory", path: "/tmp/vol1" },
			organizationId: session1.organizationId,
			status: "unmounted",
		});

		const repoId = crypto.randomUUID();
		await db.insert(repositoriesTable).values({
			id: repoId,
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
				volumeId: volId,
				repositoryId: repoId,
				cronExpression: "0 0 * * *",
				organizationId: session1.organizationId,
			})
			.returning();

		const [destination] = await db
			.insert(notificationDestinationsTable)
			.values({
				name: "Org 1 Destination",
				enabled: true,
				type: "discord",
				config: { type: "discord", webhookUrl: "https://example.com/webhook" },
				organizationId: session1.organizationId,
			})
			.returning();

		await db.insert(backupScheduleNotificationsTable).values({
			scheduleId: schedule.id,
			destinationId: destination.id,
			notifyOnStart: true,
			notifyOnSuccess: true,
			notifyOnWarning: true,
			notifyOnFailure: true,
		});

		const resGet = await app.request(`/api/v1/backups/${schedule.shortId}/notifications`, {
			headers: session2.headers,
		});
		expect(resGet.status).toBe(404);

		const resPut = await app.request(`/api/v1/backups/${schedule.shortId}/notifications`, {
			method: "PUT",
			headers: {
				...session2.headers,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				assignments: [
					{
						destinationId: destination.id,
						notifyOnStart: false,
						notifyOnSuccess: false,
						notifyOnWarning: false,
						notifyOnFailure: false,
					},
				],
			}),
		});
		expect(resPut.status).toBe(404);
	});
});
