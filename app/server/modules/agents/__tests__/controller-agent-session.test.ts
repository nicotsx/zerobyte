import { expect, test, vi } from "vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { createAgentMessage } from "@zerobyte/contracts/agent-protocol";
import { createControllerAgentSession } from "../controller-agent-session";

const createSocket = () => {
	return fromPartial<Parameters<typeof createControllerAgentSession>[0]>({
		data: { id: "connection-1", agentId: "local", organizationId: null, agentName: "Local Agent" },
		send: vi.fn(),
	});
};

test("close emits a synthetic backup.cancelled for a started backup", () => {
	const onBackupCancelled = vi.fn();
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

test.each([
	{
		name: "backup.completed",
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
		name: "backup.failed",
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
		name: "backup.cancelled",
		jobId: "job-3",
		scheduleId: "schedule-3",
		terminalMessage: createAgentMessage("backup.cancelled", {
			jobId: "job-3",
			scheduleId: "schedule-3",
			message: "Backup was cancelled",
		}),
		expectedCancelledCalls: 1,
	},
])("close does not emit an extra synthetic backup.cancelled after $name", (testCase) => {
	const onBackupCancelled = vi.fn();
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
});

test("close emits a synthetic backup.cancelled for a queued backup", () => {
	const onBackupCancelled = vi.fn();
	const session = createControllerAgentSession(createSocket(), {
		onBackupCancelled,
	});

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
