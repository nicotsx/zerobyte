import { expect, test } from "vitest";
import { Effect } from "effect";
import { createAgentMessage, decodeAgentFrame, type AgentMessage } from "@zerobyte/contracts/agent-protocol";
import { createAgentMessageInbox } from "../controller/message-inbox";

const inbound = (text: string) => [decodeAgentFrame(text), Buffer.byteLength(text)] as const;

const progress = (jobId: string, files: string[] = [], scheduleId = "schedule-1") =>
	createAgentMessage("backup.progress", {
		jobId,
		scheduleId,
		progress: {
			message_type: "status",
			seconds_elapsed: 0,
			seconds_remaining: 0,
			percent_done: 0,
			total_files: 100,
			files_done: 0,
			total_bytes: 100,
			bytes_done: 0,
			current_files: files,
		},
	});

const barriers = [
	{ type: "heartbeat.pong", payload: { sentAt: 123 } },
	{ type: "backup.completed", payload: { jobId: "job-1", scheduleId: "schedule-1", exitCode: 0, result: null } },
	{ type: "backup.failed", payload: { jobId: "job-1", scheduleId: "schedule-1", error: "failed" } },
	{ type: "backup.cancelled", payload: { jobId: "job-1", scheduleId: "schedule-1" } },
	{ type: "filesystem.commandResult", payload: { commandId: "command-1", status: "error", error: "failed" } },
] satisfies AgentMessage[];

test.each(barriers)("$type remains between earlier and later progress", (barrier) => {
	const inbox = createAgentMessageInbox();
	const first = progress("job-1", ["first"]);
	const intermediate = progress("job-1", ["intermediate"]);
	const latest = progress("job-1", ["latest"]);
	const control = createAgentMessage(barrier.type, barrier.payload);

	expect(inbox.offer(...inbound(first))).toBe(true);
	expect(inbox.offer(...inbound(control))).toBe(true);
	expect(inbox.offer(...inbound(intermediate))).toBe(true);
	expect(Effect.runSync(inbox.take)).toEqual(decodeAgentFrame(first));

	expect(inbox.offer(...inbound(latest))).toBe(true);
	expect(Effect.runSync(inbox.take)).toEqual(decodeAgentFrame(control));
	expect(Effect.runSync(inbox.take)).toEqual(decodeAgentFrame(latest));
	expect(inbox.snapshot()).toMatchObject({ inboundQueuedMessages: 0, queuedBytes: 0, coalescedProgressMessages: 1 });
});

test("progress for different jobs and schedules stays separate", () => {
	const inbox = createAgentMessageInbox();
	const first = progress("job-1");
	const otherJob = progress("job-2");
	const otherSchedule = progress("job-1", [], "schedule-2");
	const latest = progress("job-1", ["latest"]);

	for (const text of [first, otherJob, otherSchedule, latest]) expect(inbox.offer(...inbound(text))).toBe(true);

	expect(inbox.snapshot().inboundQueuedMessages).toBe(3);
	expect(Effect.runSync(inbox.take)).toEqual(decodeAgentFrame(latest));
	expect(Effect.runSync(inbox.take)).toEqual(decodeAgentFrame(otherJob));
	expect(Effect.runSync(inbox.take)).toEqual(decodeAgentFrame(otherSchedule));
});

test("restore progress is coalesced without losing its completion", () => {
	const inbox = createAgentMessageInbox();
	const identity = {
		restoreId: "restore-1",
		organizationId: "org-1",
		repositoryId: "repo-1",
		snapshotId: "snapshot-1",
	};
	const snapshots = [1, 2, 3].map((files) =>
		createAgentMessage("restore.progress", {
			...identity,
			progress: {
				message_type: "status",
				seconds_elapsed: files,
				percent_done: files / 3,
				total_files: 3,
				files_restored: files,
				total_bytes: 3,
				bytes_restored: files,
			},
		}),
	);
	const completed = createAgentMessage("restore.completed", {
		...identity,
		result: { message_type: "summary", files_restored: 3, files_skipped: 0, bytes_skipped: 0 },
	});

	for (const text of [...snapshots, completed]) expect(inbox.offer(...inbound(text))).toBe(true);

	expect(inbox.snapshot().inboundQueuedMessages).toBe(2);
	expect(Effect.runSync(inbox.take)).toEqual(decodeAgentFrame(snapshots[2]));
	expect(Effect.runSync(inbox.take)).toEqual(decodeAgentFrame(completed));
});

test("replacing progress respects the byte limit and accounts for UTF-8 size changes", () => {
	const inbox = createAgentMessageInbox();
	const first = progress("job-1", ["éé"]);
	const smaller = progress("job-1", ["é"]);
	const larger = progress("job-1", ["ééé"]);
	const overhead = Buffer.byteLength(progress("job-2", [""]));
	const remaining = inbox.snapshot().inboundByteLimit - Buffer.byteLength(first) - overhead;
	const filler = progress("job-2", ["x".repeat(remaining)]);

	expect(inbox.offer(...inbound(first))).toBe(true);
	expect(inbox.offer(...inbound(filler))).toBe(true);
	expect(inbox.snapshot().queuedBytes).toBe(inbox.snapshot().inboundByteLimit);

	expect(inbox.offer(...inbound(larger))).toBe(false);
	expect(inbox.snapshot().coalescedProgressMessages).toBe(0);
	expect(inbox.offer(...inbound(smaller))).toBe(true);
	expect(inbox.snapshot().queuedBytes).toBe(inbox.snapshot().inboundByteLimit - 2);
	expect(Effect.runSync(inbox.take)).toEqual(decodeAgentFrame(smaller));
	expect(Effect.runSync(inbox.take)).toEqual(decodeAgentFrame(filler));
	expect(inbox.snapshot().queuedBytes).toBe(0);
});

test("shutdown releases pending progress and prevents new admission", () => {
	const inbox = createAgentMessageInbox();

	expect(inbox.offer(...inbound(progress("job-1")))).toBe(true);
	Effect.runSync(inbox.shutdown);

	expect(inbox.snapshot()).toMatchObject({ inboundQueuedMessages: 0, queuedBytes: 0 });
	expect(inbox.offer(...inbound(progress("job-1")))).toBe(false);
});
