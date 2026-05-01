import { Effect, Exit, Scope } from "effect";
import { expect, test, vi } from "vitest";
import waitForExpect from "wait-for-expect";
import { fromPartial } from "@total-typescript/shoehorn";
import { LOCAL_AGENT_ID, LOCAL_AGENT_KIND, LOCAL_AGENT_NAME } from "../constants";
import { createControllerAgentSession } from "../controller/session";

const createSocket = (overrides: Partial<Parameters<typeof createControllerAgentSession>[0]> = {}) => {
	return {
		data: {
			id: "connection-1",
			agentId: LOCAL_AGENT_ID,
			organizationId: null,
			agentName: LOCAL_AGENT_NAME,
			agentKind: LOCAL_AGENT_KIND,
		},
		send: vi.fn(() => 1),
		close: vi.fn(),
		...overrides,
	};
};

const createSession = (
	handlers: Partial<Parameters<typeof createControllerAgentSession>[1]> = {},
	socket = createSocket(),
) => {
	const scope = Effect.runSync(Scope.make());
	const sessionHandlers: Parameters<typeof createControllerAgentSession>[1] = {
		onReady: () => Effect.void,
		onHeartbeatPong: () => Effect.void,
		onDisconnect: () => Effect.void,
		onBackupStarted: () => Effect.void,
		onBackupProgress: () => Effect.void,
		onBackupCompleted: () => Effect.void,
		onBackupFailed: () => Effect.void,
		onBackupCancelled: () => Effect.void,
		...handlers,
	};

	try {
		const session = Effect.runSync(
			Scope.extend(createControllerAgentSession(fromPartial(socket), sessionHandlers), scope),
		);

		return {
			session,
			run: () => {
				Effect.runFork(Scope.extend(session.run, scope));
			},
			socket,
			close: () => {
				Effect.runSync(Scope.close(scope, Exit.succeed(undefined)));
			},
			closeAsync: () => {
				return Effect.runPromise(Scope.close(scope, Exit.succeed(undefined)));
			},
		};
	} catch (error) {
		Effect.runSync(Scope.close(scope, Exit.fail(error)));
		throw error;
	}
};

test("close reports a transport disconnect", () => {
	const onDisconnect = vi.fn(() => Effect.void);
	const { close } = createSession({ onDisconnect });

	close();

	expect(onDisconnect).toHaveBeenCalledTimes(1);
	expect(onDisconnect).toHaveBeenCalledWith(
		expect.objectContaining({
			agentId: LOCAL_AGENT_ID,
			agentName: LOCAL_AGENT_NAME,
		}),
	);
});

test("sendBackup only queues the transport message", () => {
	const onBackupCancelled = vi.fn(() => Effect.void);
	const { session, close } = createSession({ onBackupCancelled });

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
			webhooks: { pre: null, post: null },
			webhookAllowedOrigins: [],
			webhookTimeoutMs: 60_000,
		}),
	);

	close();

	expect(onBackupCancelled).not.toHaveBeenCalled();
});

test("a dropped backup.cancel closes the session and reports a transport disconnect", async () => {
	const send = vi.fn(() => 0);
	const socket = createSocket({ send, close: vi.fn() });
	const onDisconnect = vi.fn(() => Effect.void);
	const { session, run, closeAsync } = createSession({ onDisconnect }, socket);

	try {
		run();
		Effect.runSync(
			session.sendBackupCancel({
				jobId: "job-1",
				scheduleId: "schedule-1",
			}),
		);

		await waitForExpect(() => {
			expect(send).toHaveBeenCalledTimes(1);
			expect(socket.close).toHaveBeenCalledTimes(1);
			expect(onDisconnect).toHaveBeenCalledTimes(1);
			expect(onDisconnect).toHaveBeenCalledWith(
				expect.objectContaining({
					agentId: LOCAL_AGENT_ID,
				}),
			);
		});
	} finally {
		await closeAsync();
	}
});
