import { beforeEach, describe, expect, test } from "vitest";
import { createApp } from "~/server/app";
import { db } from "~/server/db/db";
import { tasksTable } from "~/server/db/schema";
import { taskChangedEventName, tasksSnapshotEventName } from "~/schemas/task-events";
import type { TaskResourceType } from "~/schemas/tasks";
import { createTestSession } from "~/test/helpers/auth";
import { taskStore } from "../tasks.store";
import { runTaskLifecycle } from "../tasks.lifecycle";

const app = createApp();

const createTask = (
	organizationId: string,
	options: { resourceType?: TaskResourceType; resourceId?: string; snapshotIds?: string[] } = {},
) => {
	const resourceId = options.resourceId ?? "repo-short";
	const snapshotIds = options.snapshotIds ?? ["snapshot-1"];

	return taskStore.create({
		organizationId,
		resourceType: options.resourceType ?? "repository",
		resourceId,
		targetDisplayName: `Target ${resourceId}`,
		input: {
			kind: "deleteSnapshots",
			repositoryId: resourceId,
			snapshotIds,
		},
	});
};

const createRestoreTask = (organizationId: string, repositoryId = "repo-short", snapshotId = "snapshot-1") => {
	return taskStore.create({
		organizationId,
		resourceType: "repository",
		resourceId: repositoryId,
		operationKey: snapshotId,
		targetDisplayName: `Repository ${repositoryId}`,
		input: {
			kind: "restore",
			repositoryId,
			snapshotId,
			target: "/tmp/restore",
		},
	});
};

const createBackupTask = (organizationId: string) => {
	return taskStore.create({
		organizationId,
		resourceType: "backup_schedule",
		resourceId: "schedule-short",
		targetDisplayName: "Backup schedule",
		input: {
			kind: "backup",
			scheduleId: 1,
			scheduleShortId: "schedule-short",
			manual: true,
		},
	});
};

const createMirrorStatusTask = (organizationId: string) => {
	return taskStore.create({
		organizationId,
		resourceType: "backup_schedule",
		resourceId: "schedule-short",
		operationKey: "source-repository:mirror-repository",
		targetDisplayName: "Backup schedule",
		input: {
			kind: "mirrorStatus",
			scheduleId: 1,
			scheduleShortId: "schedule-short",
			sourceRepositoryId: "source-repository",
			mirrorRepositoryId: "mirror-repository",
		},
	});
};

const readStreamUntil = async (body: ReadableStream<Uint8Array>, matcher: string) => {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let text = "";

	try {
		for (let i = 0; i < 10 && !text.includes(matcher); i++) {
			const result = await reader.read();
			if (result.done) break;
			text += decoder.decode(result.value, { stream: true });
		}
	} finally {
		void reader.cancel();
		reader.releaseLock();
	}

	return text;
};

const readReaderUntil = async (
	reader: ReadableStreamDefaultReader<Uint8Array>,
	decoder: TextDecoder,
	text: string,
	matcher: string,
) => {
	let nextText = text;

	for (let i = 0; i < 10 && !nextText.includes(matcher); i++) {
		const result = await reader.read();
		if (result.done) break;
		nextText += decoder.decode(result.value, { stream: true });
	}

	return nextText;
};

beforeEach(async () => {
	await db.delete(tasksTable);
});

describe("tasksController", () => {
	test("hides mirror status lookups from global task lists and streams but keeps task-specific access", async () => {
		const session = await createTestSession();
		const task = createMirrorStatusTask(session.organizationId);
		const visibleTask = createTask(session.organizationId);

		const listResponse = await app.request("/api/v1/tasks", { headers: session.headers });
		const streamResponse = await app.request("/api/v1/tasks/events", { headers: session.headers });

		expect(listResponse.status).toBe(200);
		const activeTasks = await listResponse.json();
		expect(activeTasks.map((entry: { id: string }) => entry.id)).toEqual([visibleTask.id]);
		expect(streamResponse.status).toBe(200);
		const reader = streamResponse.body!.getReader();
		const decoder = new TextDecoder();

		try {
			let streamText = await readReaderUntil(reader, decoder, "", tasksSnapshotEventName);
			expect(streamText).toContain(visibleTask.id);
			expect(streamText).not.toContain(task.id);

			taskStore.markRunning(task.id);
			taskStore.complete(task.id, {
				kind: "mirrorStatus",
				sourceCount: 1,
				mirrorCount: 0,
				missingSnapshots: [{ short_id: "snapshot-1", time: "2025-01-01T00:00:00Z", size: 1 }],
			});
			taskStore.fail(visibleTask.id, "visible task finished");
			streamText = await readReaderUntil(reader, decoder, streamText, "visible task finished");

			expect(streamText).toContain(`event: ${taskChangedEventName}`);
			expect(streamText).toContain("visible task finished");
			expect(streamText).not.toContain(task.id);
		} finally {
			void reader.cancel();
			reader.releaseLock();
		}

		const taskResponse = await app.request(`/api/v1/tasks/${task.id}`, { headers: session.headers });
		const taskStreamResponse = await app.request(`/api/v1/tasks/${task.id}/events`, { headers: session.headers });
		expect(taskResponse.status).toBe(200);
		expect(await taskResponse.json()).toMatchObject({
			id: task.id,
			kind: "mirrorStatus",
			result: { kind: "mirrorStatus", missingSnapshots: [{ short_id: "snapshot-1" }] },
		});
		expect(taskStreamResponse.status).toBe(200);
		const taskStreamText = await readStreamUntil(taskStreamResponse.body!, taskChangedEventName);
		expect(taskStreamText).toContain('"status":"succeeded"');
		expect(taskStreamText).toContain('"kind":"mirrorStatus"');
	});

	test("requests cancellation for a cancellable running task", async () => {
		const session = await createTestSession();
		const task = createRestoreTask(session.organizationId);
		const lifecycle = runTaskLifecycle({
			taskId: task.id,
			label: "restore task",
			cancellable: true,
			run: (signal) =>
				new Promise<never>((_, reject) => {
					signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), {
						once: true,
					});
				}),
		});

		const res = await app.request(`/api/v1/tasks/${task.id}/cancel`, {
			method: "POST",
			headers: session.headers,
		});

		expect(res.status).toBe(202);
		await expect(res.json()).resolves.toEqual({ status: "cancelling" });
		await lifecycle;
		expect(taskStore.findById({ organizationId: session.organizationId, taskId: task.id })?.status).toBe(
			"cancelled",
		);
	});

	test("cancels an orphaned running task", async () => {
		const session = await createTestSession();
		const task = createRestoreTask(session.organizationId);
		taskStore.markRunning(task.id);

		const res = await app.request(`/api/v1/tasks/${task.id}/cancel`, {
			method: "POST",
			headers: session.headers,
		});

		expect(res.status).toBe(202);
		await expect(res.json()).resolves.toEqual({ status: "cancelling" });
		const cancelledTask = taskStore.findById({ organizationId: session.organizationId, taskId: task.id });
		expect(cancelledTask?.status).toBe("cancelled");
		expect(cancelledTask?.cancellationRequested).toBe(true);
	});

	test("cancels an orphaned running backup task", async () => {
		const session = await createTestSession();
		const task = createBackupTask(session.organizationId);
		taskStore.markRunning(task.id);

		const res = await app.request(`/api/v1/tasks/${task.id}/cancel`, {
			method: "POST",
			headers: session.headers,
		});

		expect(res.status).toBe(202);
		const cancelledTask = taskStore.findById({ organizationId: session.organizationId, taskId: task.id });
		expect(cancelledTask?.status).toBe("cancelled");
		expect(cancelledTask?.cancellationRequested).toBe(true);
	});

	test("rejects cancellation for a task without cancellation support", async () => {
		const session = await createTestSession();
		const task = createTask(session.organizationId);
		let finishExecution: (() => void) | undefined;
		let markExecutionStarted: (() => void) | undefined;
		const executionStarted = new Promise<void>((resolve) => {
			markExecutionStarted = resolve;
		});
		const lifecycle = runTaskLifecycle({
			taskId: task.id,
			label: "snapshot deletion task",
			run: async () => {
				markExecutionStarted?.();
				await new Promise<void>((resolve) => {
					finishExecution = resolve;
				});
				return { kind: "deleteSnapshots", deletedSnapshotIds: ["snapshot-1"] };
			},
		});
		await executionStarted;

		const res = await app.request(`/api/v1/tasks/${task.id}/cancel`, {
			method: "POST",
			headers: session.headers,
		});

		expect(res.status).toBe(409);
		finishExecution?.();
		await lifecycle;
	});

	test("returns a task by id", async () => {
		const session = await createTestSession();
		const task = createTask(session.organizationId);

		const res = await app.request(`/api/v1/tasks/${task.id}`, {
			headers: session.headers,
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toMatchObject({
			id: task.id,
			kind: "deleteSnapshots",
			input: { kind: "deleteSnapshots", repositoryId: "repo-short", snapshotIds: ["snapshot-1"] },
		});
		expect(body.organizationId).toBeUndefined();
		expect(body.outcome).toBeUndefined();
		expect(body.targetDisplayName).toBeUndefined();
	});

	test("streams the requested task state", async () => {
		const session = await createTestSession();
		const task = createTask(session.organizationId);

		const res = await app.request(`/api/v1/tasks/${task.id}/events`, {
			headers: session.headers,
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("text/event-stream");

		const text = await readStreamUntil(res.body!, taskChangedEventName);

		expect(text).toContain(`event: ${taskChangedEventName}`);
		expect(text).toContain(task.id);
		expect(text).toContain("deleteSnapshots");
		expect(text).not.toContain("organizationId");
	});

	test("streams task updates after the connection is open", async () => {
		const session = await createTestSession();
		const task = createTask(session.organizationId);

		const res = await app.request(`/api/v1/tasks/${task.id}/events`, {
			headers: session.headers,
		});

		expect(res.status).toBe(200);

		const reader = res.body!.getReader();
		const decoder = new TextDecoder();
		let text = "";

		try {
			text = await readReaderUntil(reader, decoder, text, `"id":"${task.id}"`);

			taskStore.markRunning(task.id);
			text = await readReaderUntil(reader, decoder, text, '"status":"running"');

			expect(text).toContain(`event: ${taskChangedEventName}`);
			expect(text).toContain('"status":"running"');
		} finally {
			void reader.cancel();
			reader.releaseLock();
		}
	});

	test("streams filtered task updates", async () => {
		const session = await createTestSession();
		const repoTask = createTask(session.organizationId, { resourceId: "repo-short" });
		const otherRepoTask = createTask(session.organizationId, { resourceId: "repo-other" });

		const res = await app.request(
			"/api/v1/tasks/events?kind=deleteSnapshots&resourceType=repository&resourceId=repo-short",
			{
				headers: session.headers,
			},
		);

		expect(res.status).toBe(200);

		const reader = res.body!.getReader();
		const decoder = new TextDecoder();
		let text = "";

		try {
			text = await readReaderUntil(reader, decoder, text, repoTask.id);

			expect(text).toContain(`event: ${tasksSnapshotEventName}`);
			expect(text).toContain(repoTask.id);
			expect(text).not.toContain(otherRepoTask.id);

			taskStore.complete(repoTask.id, { kind: "deleteSnapshots", deletedSnapshotIds: ["snapshot-1"] });
			text = await readReaderUntil(reader, decoder, text, '"status":"succeeded"');

			expect(text).toContain('"status":"succeeded"');
		} finally {
			void reader.cancel();
			reader.releaseLock();
		}
	});

	test("lists tasks filtered by kind and resource", async () => {
		const session = await createTestSession();
		const repoTask = createTask(session.organizationId, {
			resourceId: "repo-short",
			snapshotIds: ["snapshot-1"],
		});
		const otherRepoTask = createTask(session.organizationId, {
			resourceId: "repo-other",
			snapshotIds: ["snapshot-2"],
		});
		const restoreTask = createRestoreTask(session.organizationId);

		const byResource = await app.request("/api/v1/tasks?resourceType=repository&resourceId=repo-short", {
			headers: session.headers,
		});
		expect(byResource.status).toBe(200);
		const byResourceBody = await byResource.json();
		expect(byResourceBody).toHaveLength(2);
		expect(byResourceBody.map((task: { id: string }) => task.id).sort()).toEqual(
			[restoreTask.id, repoTask.id].sort(),
		);
		expect(
			new Set(
				byResourceBody.map(
					(task: { resourceType: string; resourceId: string }) => `${task.resourceType}:${task.resourceId}`,
				),
			),
		).toContain("repository:repo-short");

		const byKind = await app.request("/api/v1/tasks?kind=deleteSnapshots", {
			headers: session.headers,
		});
		expect(byKind.status).toBe(200);
		const byKindBody = await byKind.json();
		expect(byKindBody.map((task: { id: string }) => task.id).sort()).toEqual(
			[repoTask.id, otherRepoTask.id].sort(),
		);

		const byKindAndResource = await app.request(
			"/api/v1/tasks?kind=deleteSnapshots&resourceType=repository&resourceId=repo-short",
			{
				headers: session.headers,
			},
		);
		expect(byKindAndResource.status).toBe(200);
		const byKindAndResourceBody = await byKindAndResource.json();
		expect(byKindAndResourceBody.map((task: { id: string }) => task.id).sort()).toEqual([repoTask.id]);
	});

	test("lists only the task for the exact operation key", async () => {
		const session = await createTestSession();
		const matchingTask = createRestoreTask(session.organizationId, "repo-short", "snapshot-1");
		createRestoreTask(session.organizationId, "repo-short", "snapshot-2");

		const res = await app.request(
			"/api/v1/tasks?kind=restore&resourceType=repository&resourceId=repo-short&operationKey=snapshot-1",
			{ headers: session.headers },
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.map((task: { id: string }) => task.id)).toEqual([matchingTask.id]);
	});

	test("streams task snapshots and updates only for the exact operation key", async () => {
		const session = await createTestSession();
		const matchingTask = createRestoreTask(session.organizationId, "repo-short", "snapshot-1");
		const otherSnapshotTask = createRestoreTask(session.organizationId, "repo-short", "snapshot-2");

		const res = await app.request(
			"/api/v1/tasks/events?kind=restore&resourceType=repository&resourceId=repo-short&operationKey=snapshot-1",
			{ headers: session.headers },
		);

		expect(res.status).toBe(200);

		const reader = res.body!.getReader();
		const decoder = new TextDecoder();
		let text = "";

		try {
			text = await readReaderUntil(reader, decoder, text, matchingTask.id);

			expect(text).toContain(`event: ${tasksSnapshotEventName}`);
			expect(text).toContain(matchingTask.id);
			expect(text).not.toContain(otherSnapshotTask.id);

			taskStore.fail(otherSnapshotTask.id, "other snapshot failed");
			taskStore.fail(matchingTask.id, "matching snapshot failed");
			text = await readReaderUntil(reader, decoder, text, "matching snapshot failed");

			expect(text).toContain(`event: ${taskChangedEventName}`);
			expect(text).toContain("matching snapshot failed");
			expect(text).not.toContain("other snapshot failed");
		} finally {
			void reader.cancel();
			reader.releaseLock();
		}
	});
});
