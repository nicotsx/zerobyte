import { beforeEach, describe, expect, test } from "vitest";
import { createApp } from "~/server/app";
import { db } from "~/server/db/db";
import { tasksTable } from "~/server/db/schema";
import { taskChangedEventName, tasksSnapshotEventName } from "~/schemas/task-events";
import type { TaskResourceType } from "~/schemas/tasks";
import { createTestSession } from "~/test/helpers/auth";
import { taskStore } from "../tasks.store";

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
		input: {
			kind: "deleteSnapshots",
			repositoryId: resourceId,
			snapshotIds,
		},
	});
};

const createRestoreTask = (organizationId: string, repositoryId = "repo-short") => {
	return taskStore.create({
		organizationId,
		resourceType: "repository",
		resourceId: repositoryId,
		input: {
			kind: "restore",
			repositoryId,
			snapshotId: "snapshot-1",
			target: "/tmp/restore",
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
});
