import { Effect, Exit, Fiber, Scope } from "effect";
import { expect, test, vi } from "vitest";
import waitForExpect from "wait-for-expect";
import { fromPartial } from "@total-typescript/shoehorn";
import { createAgentMessage, type AgentMessage } from "@zerobyte/contracts/agent-protocol";
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
	onEvent: Parameters<typeof createControllerAgentSession>[1] = () => Effect.void,
	socket = createSocket(),
) => {
	const scope = Effect.runSync(Scope.make());

	try {
		const session = Effect.runSync(Scope.extend(createControllerAgentSession(fromPartial(socket), onEvent), scope));

		return {
			session,
			run: () => {
				const fiber = Effect.runFork(Scope.extend(session.run, scope));
				Effect.runSync(Scope.addFinalizer(scope, Fiber.interrupt(fiber)));
				return fiber;
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

test("closing the session scope interrupts the session runner", async () => {
	const { run, closeAsync } = createSession();
	const fiber = run();

	await closeAsync();

	const exit = await Effect.runPromise(Fiber.await(fiber).pipe(Effect.timeout("100 millis")));
	expect(Exit.isInterrupted(exit)).toBe(true);
});

test("close reports a transport disconnect", () => {
	const onEvent = vi.fn(() => Effect.void);
	const { close } = createSession(onEvent);

	close();

	expect(onEvent).toHaveBeenCalledTimes(1);
	expect(onEvent).toHaveBeenCalledWith(
		expect.objectContaining({
			type: "agent.disconnected",
		}),
	);
});

test("sendBackup only queues the transport message", () => {
	const onEvent = vi.fn(() => Effect.void);
	const { session, close } = createSession(onEvent);

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

	expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: "backup.cancelled" }));
});

test("invalid inbound messages are ignored", () => {
	const onEvent = vi.fn(() => Effect.void);
	const { session, close } = createSession(onEvent);

	Effect.runSync(session.handleMessage("not json"));
	Effect.runSync(session.handleMessage(JSON.stringify({ type: "backup.progress", payload: {} })));

	expect(onEvent).not.toHaveBeenCalled();
	close();
});

test("agent.ready marks the session ready and forwards the event", () => {
	const onEvent = vi.fn(() => Effect.void);
	const { session, close } = createSession(onEvent);

	expect(Effect.runSync(session.isReady())).toBe(false);
	Effect.runSync(session.handleMessage(createAgentMessage("agent.ready", { agentId: LOCAL_AGENT_ID })));

	expect(Effect.runSync(session.isReady())).toBe(true);
	expect(onEvent).toHaveBeenCalledWith({ type: "agent.ready", payload: { agentId: LOCAL_AGENT_ID } });
	close();
});

test("backup agent messages are forwarded unchanged", () => {
	const onEvent = vi.fn(() => Effect.void);
	const { session, close } = createSession(onEvent);
	const message = {
		type: "backup.progress" as const,
		payload: {
			jobId: "job-1",
			scheduleId: "schedule-1",
			progress: {
				message_type: "status" as const,
				seconds_elapsed: 0,
				seconds_remaining: 0,
				percent_done: 0.5,
				total_files: 0,
				files_done: 0,
				total_bytes: 0,
				bytes_done: 0,
				current_files: [],
			},
		},
	} satisfies Extract<AgentMessage, { type: "backup.progress" }>;

	Effect.runSync(session.handleMessage(createAgentMessage(message.type, message.payload)));

	expect(onEvent).toHaveBeenCalledWith(
		expect.objectContaining({
			type: message.type,
			payload: expect.objectContaining({
				jobId: message.payload.jobId,
				scheduleId: message.payload.scheduleId,
				progress: expect.objectContaining(message.payload.progress),
			}),
		}),
	);
	close();
});

test("a dropped backup.cancel closes the session and reports a transport disconnect", async () => {
	const send = vi.fn(() => 0);
	const socket = createSocket({ send, close: vi.fn() });
	const onEvent = vi.fn(() => Effect.void);
	const { session, run, closeAsync } = createSession(onEvent, socket);

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
			expect(onEvent).toHaveBeenCalledTimes(1);
			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "agent.disconnected",
				}),
			);
		});
	} finally {
		await closeAsync();
	}
});
