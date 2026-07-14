import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "~/server/app";
import { db } from "~/server/db/db";
import { tasksTable } from "~/server/db/schema";
import { createTestSession } from "~/test/helpers/auth";
import { taskStore } from "../tasks.store";

const app = createApp();

let session: Awaited<ReturnType<typeof createTestSession>>;

const createRepositoryTask = (
	organizationId: string,
	id: string,
	kind: "deleteSnapshots" | "doctor" = "deleteSnapshots",
	repositoryId = "repo-missing",
) => {
	return taskStore.create({
		id,
		organizationId,
		resourceType: "repository",
		resourceId: repositoryId,
		targetDisplayName: `Repository ${repositoryId}`,
		input:
			kind === "doctor"
				? { kind: "doctor", repositoryId }
				: { kind: "deleteSnapshots", repositoryId, snapshotIds: ["snapshot-1"] },
	});
};

const setCreatedAt = (taskId: string, createdAt: number) => {
	db.update(tasksTable).set({ createdAt }).where(eq(tasksTable.id, taskId)).run();
};

beforeAll(async () => {
	session = await createTestSession();
});

beforeEach(async () => {
	await db.delete(tasksTable);
});

describe("task history", () => {
	test("isolates history by organization without changing the active task endpoint", async () => {
		const otherSession = await createTestSession();
		const visible = createRepositoryTask(session.organizationId, "visible-task");
		createRepositoryTask(otherSession.organizationId, "hidden-task");

		const historyResponse = await app.request("/api/v1/tasks/history", { headers: session.headers });
		const activeResponse = await app.request("/api/v1/tasks", { headers: session.headers });

		expect(historyResponse.status).toBe(200);
		expect((await historyResponse.json()).items.map((item: { id: string }) => item.id)).toEqual([visible.id]);
		expect(activeResponse.status).toBe(200);
		expect(await activeResponse.json()).toEqual([
			expect.objectContaining({
				id: visible.id,
				kind: "deleteSnapshots",
				input: expect.objectContaining({ snapshotIds: ["snapshot-1"] }),
			}),
		]);
	});

	test("paginates equal timestamps by descending id with page metadata", async () => {
		const createdAt = 1_750_000_000_000;
		for (let index = 0; index < 30; index += 1) {
			const id = `task-${String(index).padStart(2, "0")}`;
			createRepositoryTask(session.organizationId, id);
			setCreatedAt(id, createdAt);
		}

		const firstResponse = await app.request("/api/v1/tasks/history", { headers: session.headers });
		const firstPage = await firstResponse.json();
		const secondResponse = await app.request("/api/v1/tasks/history?page=2", { headers: session.headers });
		const secondPage = await secondResponse.json();

		expect(firstPage.items).toHaveLength(25);
		expect(firstPage.items.map((item: { id: string }) => item.id)).toEqual(
			Array.from({ length: 25 }, (_, index) => `task-${String(29 - index).padStart(2, "0")}`),
		);
		expect(firstPage).toMatchObject({ page: 1, pageSize: 25, totalItems: 30, totalPages: 2 });
		expect(secondPage.items.map((item: { id: string }) => item.id)).toEqual([
			"task-04",
			"task-03",
			"task-02",
			"task-01",
			"task-00",
		]);
		expect(secondPage).toMatchObject({ page: 2, pageSize: 25, totalItems: 30, totalPages: 2 });
	});

	test("filters stored outcomes in the database without treating legacy rows as filterable", async () => {
		const queued = createRepositoryTask(session.organizationId, "queued");
		const running = createRepositoryTask(session.organizationId, "running");
		taskStore.markRunning(running.id);
		const cancelling = createRepositoryTask(session.organizationId, "cancelling");
		taskStore.requestCancel(cancelling.id);

		const warning = taskStore.create({
			id: "warning",
			organizationId: session.organizationId,
			resourceType: "backup_schedule",
			resourceId: "999",
			targetDisplayName: "Warning backup",
			input: { kind: "backup", scheduleId: 999, scheduleShortId: "missing-backup", manual: false },
		});
		taskStore.complete(warning.id, {
			kind: "backup",
			exitCode: 3,
			result: null,
			warningDetails: "Some files could not be read",
		});

		const doctor = createRepositoryTask(session.organizationId, "doctor-error", "doctor");
		taskStore.complete(doctor.id, {
			kind: "doctor",
			repositoryStatus: "error",
			lastChecked: Date.now(),
			lastError: "Repository index is damaged",
			doctorResult: { success: false, completedAt: Date.now(), steps: [] },
		});
		const legacyDoctor = createRepositoryTask(session.organizationId, "legacy-doctor", "doctor");
		db.update(tasksTable)
			.set({
				status: "failed",
				outcome: null,
				error: "Legacy task error is still visible",
				finishedAt: Date.now(),
			})
			.where(eq(tasksTable.id, legacyDoctor.id))
			.run();

		const failed = createRepositoryTask(session.organizationId, "failed");
		taskStore.fail(failed.id, "Restic exited unexpectedly");
		const succeeded = createRepositoryTask(session.organizationId, "succeeded", "deleteSnapshots", "success-repo");
		taskStore.complete(succeeded.id, { kind: "deleteSnapshots", deletedSnapshotIds: ["snapshot-1"] });
		const cancelled = createRepositoryTask(session.organizationId, "cancelled");
		taskStore.cancel(cancelled.id, "Stopped by the user");
		const stale = createRepositoryTask(session.organizationId, "stale", "deleteSnapshots", "stale-repo");
		taskStore.markActiveStale({
			organizationId: session.organizationId,
			resourceId: stale.resourceId,
			error: "Agent lost",
		});

		const runningResponse = await app.request("/api/v1/tasks/history?outcome=running", {
			headers: session.headers,
		});
		const runningItems = (await runningResponse.json()).items;
		expect(new Set(runningItems.map((item: { id: string }) => item.id))).toEqual(
			new Set([queued.id, running.id, cancelling.id]),
		);
		expect(new Set(runningItems.map((item: { outcome: string }) => item.outcome))).toEqual(new Set(["running"]));

		const warningResponse = await app.request("/api/v1/tasks/history?outcome=warning&kind=backup", {
			headers: session.headers,
		});
		expect((await warningResponse.json()).items).toEqual([
			expect.objectContaining({ id: warning.id, outcome: "warning", message: "Some files could not be read" }),
		]);

		const errorResponse = await app.request("/api/v1/tasks/history?outcome=error", { headers: session.headers });
		const errorItems = (await errorResponse.json()).items;
		expect(errorItems).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: doctor.id, status: "succeeded", outcome: "error" }),
				expect.objectContaining({ id: failed.id, status: "failed", outcome: "error" }),
			]),
		);
		const successResponse = await app.request("/api/v1/tasks/history?outcome=success", {
			headers: session.headers,
		});
		const successItems = (await successResponse.json()).items;
		expect(successItems).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: succeeded.id, status: "succeeded", outcome: "success", message: null }),
			]),
		);
		expect(successItems).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: legacyDoctor.id })]));

		const doctorResponse = await app.request("/api/v1/tasks/history?kind=doctor", { headers: session.headers });
		expect((await doctorResponse.json()).items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: doctor.id }),
				expect.objectContaining({
					id: legacyDoctor.id,
					outcome: null,
					message: "Legacy task error is still visible",
				}),
			]),
		);

		const cancelledResponse = await app.request("/api/v1/tasks/history?outcome=cancelled", {
			headers: session.headers,
		});
		expect((await cancelledResponse.json()).items).toEqual([
			expect.objectContaining({ id: cancelled.id, message: "Stopped by the user" }),
		]);

		const staleResponse = await app.request("/api/v1/tasks/history?outcome=stale", { headers: session.headers });
		expect((await staleResponse.json()).items).toEqual([
			expect.objectContaining({ id: stale.id, message: "Agent lost" }),
		]);
	});

	test("uses stored target names while leaving legacy targets empty", async () => {
		taskStore.create({
			id: "linked-backup",
			organizationId: session.organizationId,
			resourceType: "backup_schedule",
			resourceId: "42",
			targetDisplayName: "Nightly documents",
			input: { kind: "backup", scheduleId: 42, scheduleShortId: "history-backup", manual: false },
		});
		taskStore.create({
			id: "linked-restore",
			organizationId: session.organizationId,
			resourceType: "repository",
			resourceId: "history-repo",
			operationKey: "snapshot-abc",
			targetDisplayName: "Archive vault",
			input: {
				kind: "restore",
				repositoryId: "history-repo",
				snapshotId: "snapshot-abc",
				target: "/secret/restore/path",
			},
		});
		const legacyTask = createRepositoryTask(session.organizationId, "legacy-task", "deleteSnapshots", "gone-repo");
		db.update(tasksTable)
			.set({ targetDisplayName: null, outcome: null })
			.where(eq(tasksTable.id, legacyTask.id))
			.run();
		const futureResource = createRepositoryTask(
			session.organizationId,
			"future-resource",
			"deleteSnapshots",
			"future-42",
		);
		db.update(tasksTable)
			.set({ resourceType: "future_resource" })
			.where(eq(tasksTable.id, futureResource.id))
			.run();

		const response = await app.request("/api/v1/tasks/history", { headers: session.headers });
		const body = await response.json();
		const itemsById = new Map(body.items.map((item: { id: string }) => [item.id, item]));

		expect(itemsById.get("linked-backup")).toMatchObject({
			taskType: "Backup",
			target: { label: "Nightly documents", href: "/backups/history-backup" },
		});
		expect(itemsById.get("linked-restore")).toMatchObject({
			taskType: "Restore",
			target: {
				label: "snapshot-abc",
				secondary: "Archive vault",
				href: "/repositories/history-repo/snapshot-abc",
			},
		});
		expect(itemsById.get("legacy-task")).toMatchObject({
			target: { label: "No target", secondary: null, href: null },
		});
		expect(itemsById.get("future-resource")).toMatchObject({
			target: { label: "Repository future-42", secondary: null, href: null },
		});
		expect(JSON.stringify(body)).not.toContain("/secret/restore/path");
		expect(JSON.stringify(body)).not.toContain("snapshotIds");
		expect(JSON.stringify(body)).not.toContain("organizationId");
	});

	test("rejects invalid filters and page numbers", async () => {
		for (const query of ["kind=futureTask", "outcome=unknown", "page=0", "page=-1", "page=abc", "page=1.5"]) {
			const response = await app.request(`/api/v1/tasks/history?${query}`, { headers: session.headers });
			expect(response.status).toBe(400);
		}
	});
});
