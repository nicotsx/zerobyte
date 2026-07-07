import { beforeEach, describe, expect, test } from "vitest";
import { createApp } from "~/server/app";
import { db } from "~/server/db/db";
import { tasksTable } from "~/server/db/schema";
import { taskChangedEventName } from "~/schemas/task-events";
import { createTestSession } from "~/test/helpers/auth";
import { taskStore } from "../tasks.store";

const app = createApp();

const createTask = (organizationId: string) => {
	return taskStore.create({
		organizationId,
		resourceType: "repository",
		resourceId: "repo-short",
		input: {
			kind: "deleteSnapshots",
			repositoryId: "repo-short",
			snapshotIds: ["snapshot-1"],
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
});
