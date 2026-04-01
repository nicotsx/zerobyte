import { expect, mock, test } from "bun:test";
import { createAgentMessage } from "@zerobyte/contracts/agent-protocol";
import { createControllerAgentSession } from "../controller-agent-session";

const createSocket = () => {
	return {
		data: { id: "connection-1", agentId: "local", organizationId: null, agentName: "Local Agent" },
		send: mock(() => undefined),
	} as unknown as Parameters<typeof createControllerAgentSession>[0];
};

test("close emits a synthetic backup.cancelled for a started backup", () => {
	const onBackupCancelled = mock(() => undefined);
	const session = createControllerAgentSession(createSocket(), {
		onBackupCancelled,
	});

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
		const session = createControllerAgentSession(createSocket(), {
			onBackupCancelled,
		});

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
