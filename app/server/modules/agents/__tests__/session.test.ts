import { Effect, Exit, Scope } from "effect";
import { expect, test, vi } from "vitest";
import waitForExpect from "wait-for-expect";
import { fromPartial } from "@total-typescript/shoehorn";
import { createAgentMessage } from "@zerobyte/contracts/agent-protocol";
import { createControllerAgentSession } from "../controller/session";

const createSocket = (
	overrides: Partial<Parameters<typeof createControllerAgentSession>[0]> = {},
) => {
	return fromPartial<Parameters<typeof createControllerAgentSession>[0]>({
		data: { id: "connection-1", agentId: "local", organizationId: null, agentName: "Local Agent" },
		send: vi.fn(() => 1),
		close: vi.fn(),
		...overrides,
	});
};

const createSession = (
	handlers: Parameters<typeof createControllerAgentSession>[1] = {},
	socket = createSocket(),
) => {
	const scope = Effect.runSync(Scope.make());

	try {
		const session = Effect.runSync(Scope.extend(createControllerAgentSession(socket, handlers), scope));

		return {
			session,
			run: () => {
				Effect.runSync(Scope.extend(Effect.forkScoped(session.run), scope));
			},
			socket,
			close: () => {
				Effect.runSync(Scope.close(scope, Exit.succeed(undefined)));
			},
		};
	} catch (error) {
		Effect.runSync(Scope.close(scope, Exit.fail(error)));
		throw error;
	}
};

test("close emits a synthetic backup.cancelled for a started backup", () => {
	const onBackupCancelled = vi.fn();
	const { session, close } = createSession({
		onBackupCancelled,
	});

	Effect.runSync(
		session.handleMessage(
			createAgentMessage("backup.started", {
				jobId: "job-1",
				scheduleId: "schedule-1",
			}),
		),
	);

	close();

	expect(onBackupCancelled).toHaveBeenCalledTimes(1);
	expect(onBackupCancelled).toHaveBeenCalledWith({
		jobId: "job-1",
		scheduleId: "schedule-1",
		message: "The connection to the backup agent was lost while this backup was running. Restart the backup to ensure it completes.",
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
	const { session, close } = createSession({
		onBackupCancelled,
	});

	Effect.runSync(
		session.handleMessage(
			createAgentMessage("backup.started", {
				jobId: testCase.jobId,
				scheduleId: testCase.scheduleId,
			}),
		),
	);
	Effect.runSync(session.handleMessage(testCase.terminalMessage));
	close();

	expect(onBackupCancelled).toHaveBeenCalledTimes(testCase.expectedCancelledCalls);
});

test("close emits a synthetic backup.cancelled for a queued backup", () => {
	const onBackupCancelled = vi.fn();
	const { session, close } = createSession({
		onBackupCancelled,
	});

	Effect.runSync(
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
				rcloneConfigFile: "/tmp/rclone.conf",
			},
		}),
	);

	close();

	expect(onBackupCancelled).toHaveBeenCalledTimes(1);
	expect(onBackupCancelled).toHaveBeenCalledWith({
		jobId: "job-queued",
		scheduleId: "schedule-queued",
		message: "The connection to the backup agent was lost before this backup started. Restart the backup to ensure it completes.",
	});
});

test("a dropped backup.cancel closes the session and emits a synthetic backup.cancelled", async () => {
	const send = vi.fn(() => 0);
	const socket = createSocket({ send, close: vi.fn() });
	const onBackupCancelled = vi.fn();
	const { session, run, close: closeSession } = createSession({ onBackupCancelled }, socket);

	try {
		run();
		Effect.runSync(
			session.handleMessage(
				createAgentMessage("backup.started", {
					jobId: "job-1",
					scheduleId: "schedule-1",
				}),
			),
		);
		Effect.runSync(
			session.sendBackupCancel({
				jobId: "job-1",
				scheduleId: "schedule-1",
			}),
		);

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
	} finally {
		closeSession();
	}
});
