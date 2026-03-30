import { expect, mock, test } from "bun:test";
import waitForExpect from "wait-for-expect";
import { createAgentMessage } from "@zerobyte/contracts/agent-protocol";
import { createControllerAgentSession } from "../controller-agent-session";

const createSocket = (send = mock(() => 1)) => {
	const close = mock(() => undefined);

	return {
		data: { id: "connection-1", agentId: "local", organizationId: null, agentName: "Local Agent" },
		send,
		close,
	};
};

test("close emits a synthetic backup.cancelled for a started backup", () => {
	const onBackupCancelled = mock(() => undefined);
	const session = createControllerAgentSession(
		createSocket() as unknown as Parameters<typeof createControllerAgentSession>[0],
		{
			onBackupCancelled,
		},
	);

	session.handleMessage(
		createAgentMessage("backup.started", {
			jobId: "job-1",
			scheduleId: "schedule-1",
		}),
	);

	session.close();

	expect(onBackupCancelled).toHaveBeenCalledTimes(1);
	expect(onBackupCancelled).toHaveBeenCalledWith({
		jobId: "job-1",
		scheduleId: "schedule-1",
		message:
			"The connection to the backup agent was lost while this backup was running. Restart the backup to ensure it completes.",
	});
});

test("close does not emit a synthetic backup.cancelled after a terminal event", () => {
	for (const testCase of [
		{
			jobId: "job-1",
			scheduleId: "schedule-1",
			terminalMessage: createAgentMessage("backup.completed", {
				jobId: "job-1",
				scheduleId: "schedule-1",
				exitCode: 0,
				result: null,
			}),
			expectedCancelledCalls: 0,
		},
		{
			jobId: "job-2",
			scheduleId: "schedule-2",
			terminalMessage: createAgentMessage("backup.failed", {
				jobId: "job-2",
				scheduleId: "schedule-2",
				error: "backup failed",
			}),
			expectedCancelledCalls: 0,
		},
		{
			jobId: "job-3",
			scheduleId: "schedule-3",
			terminalMessage: createAgentMessage("backup.cancelled", {
				jobId: "job-3",
				scheduleId: "schedule-3",
				message: "Backup was cancelled",
			}),
			expectedCancelledCalls: 1,
		},
	]) {
		const onBackupCancelled = mock(() => undefined);
		const session = createControllerAgentSession(
			createSocket() as unknown as Parameters<typeof createControllerAgentSession>[0],
			{
				onBackupCancelled,
			},
		);

		session.handleMessage(
			createAgentMessage("backup.started", {
				jobId: testCase.jobId,
				scheduleId: testCase.scheduleId,
			}),
		);
		session.handleMessage(testCase.terminalMessage);
		session.close();

		expect(onBackupCancelled).toHaveBeenCalledTimes(testCase.expectedCancelledCalls);
	}
});

test("close emits a synthetic backup.cancelled for a queued backup", () => {
	const onBackupCancelled = mock(() => undefined);
	const session = createControllerAgentSession(
		createSocket() as unknown as Parameters<typeof createControllerAgentSession>[0],
		{
			onBackupCancelled,
		},
	);

	session.sendBackup({
		jobId: "job-queued",
		scheduleId: "schedule-queued",
		organizationId: "org-1",
		sourcePath: "/tmp/source",
		repositoryConfig: {
			backend: "local",
			path: "/tmp/repository",
		},
		options: {},
		runtime: {
			password: "password",
			cacheDir: "/tmp/cache",
			passFile: "/tmp/pass",
			defaultExcludes: [],
		},
	});

	session.close();

	expect(onBackupCancelled).toHaveBeenCalledTimes(1);
	expect(onBackupCancelled).toHaveBeenCalledWith({
		jobId: "job-queued",
		scheduleId: "schedule-queued",
		message:
			"The connection to the backup agent was lost before this backup started. Restart the backup to ensure it completes.",
	});
});

test("a dropped backup.cancel closes the session and emits a synthetic backup.cancelled", async () => {
	const send = mock(() => 0);
	const socket = createSocket(send);
	const onBackupCancelled = mock(() => undefined);
	const session = createControllerAgentSession(
		socket as unknown as Parameters<typeof createControllerAgentSession>[0],
		{
			onBackupCancelled,
		},
	);

	session.handleMessage(
		createAgentMessage("backup.started", {
			jobId: "job-1",
			scheduleId: "schedule-1",
		}),
	);
	session.sendBackupCancel({
		jobId: "job-1",
		scheduleId: "schedule-1",
	});

	await waitForExpect(() => {
		expect(send).toHaveBeenCalledTimes(1);
		expect(socket.close).toHaveBeenCalledTimes(1);
		expect(onBackupCancelled).toHaveBeenCalledTimes(1);
		expect(onBackupCancelled).toHaveBeenCalledWith({
			jobId: "job-1",
			scheduleId: "schedule-1",
			message:
				"The connection to the backup agent was lost while this backup was running. Restart the backup to ensure it completes.",
		});
	});
});
