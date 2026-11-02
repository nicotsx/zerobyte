import { afterEach, expect, test, vi } from "vitest";
import { Effect } from "effect";
import { logger } from "@zerobyte/core/node";
import { AGENT_PROTOCOL_VERSION, createAgentMessage } from "@zerobyte/contracts/agent-protocol";
import { createAgentConnection, type ConnectionEvent } from "../controller/connection";

const agentsService = vi.hoisted(() => ({
	markAgentConnecting: vi.fn(() => Promise.resolve({ id: "local" })),
	markAgentOnline: vi.fn(() => Promise.resolve()),
	markAgentSeen: vi.fn(() => Promise.resolve()),
}));

vi.mock("../agents.service", () => ({ agentsService }));

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	agentsService.markAgentSeen.mockReset().mockResolvedValue(undefined);
});

const connect = async (onEvent: (event: ConnectionEvent) => Effect.Effect<void, Error> = () => Effect.void) => {
	vi.useFakeTimers({
		toFake: ["Date", "performance", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
	});
	const close = vi.fn();
	const onClosed = vi.fn();
	const connection = createAgentConnection(
		{
			id: "heartbeat-test",
			agentId: "local",
			agentName: "Local Agent",
			agentKind: "local",
			organizationId: null,
			credentialVersion: 0,
		},
		{ send: () => 1, close },
		{ onEvent, onReady: Effect.void, onClosed: Effect.sync(onClosed) },
	);
	const receive = async (text: string) => {
		await Effect.runPromise(connection.receive(text));
		await vi.advanceTimersByTimeAsync(0);
	};

	await Effect.runPromise(connection.start);
	await receive(
		createAgentMessage("agent.ready", {
			agentId: "local",
			protocolVersion: AGENT_PROTOCOL_VERSION,
			hostname: "host",
			platform: "linux",
			capabilities: {},
		}),
	);

	expect(connection.isReady()).toBe(true);

	return { connection, receive, close, onClosed };
};

test("fresh pongs keep the connection alive and coalesce persistence during a long database stall", async () => {
	const persistence = Promise.withResolvers<void>();
	const onEvent = vi.fn(() => Effect.void);
	agentsService.markAgentSeen.mockReturnValueOnce(persistence.promise);
	const { connection, receive, close } = await connect(onEvent);

	try {
		await receive(createAgentMessage("heartbeat.pong", { sentAt: Date.now() }));

		for (let index = 0; index < 70; index += 1) {
			await vi.advanceTimersByTimeAsync(15_000);
			await receive(createAgentMessage("heartbeat.pong", { sentAt: Date.now() }));
		}

		const latestSeenAt = Date.now();
		const completed = { jobId: "job-1", scheduleId: "schedule-1", exitCode: 0, result: null };

		await receive(createAgentMessage("backup.completed", completed));

		expect(close).not.toHaveBeenCalled();
		expect(connection.isReady()).toBe(true);
		expect(onEvent).toHaveBeenCalledWith({ type: "backup.completed", payload: completed });
		expect(agentsService.markAgentSeen).toHaveBeenCalledOnce();

		persistence.resolve();
		await vi.waitFor(() => expect(agentsService.markAgentSeen).toHaveBeenCalledTimes(2));

		expect(agentsService.markAgentSeen).toHaveBeenLastCalledWith(connection.data, latestSeenAt);
	} finally {
		persistence.resolve();
		await Effect.runPromise(connection.close("test_finished"));
	}
});

test("fresh pongs refresh liveness while a business event is blocked", async () => {
	const processing = Promise.withResolvers<void>();
	const warn = vi.spyOn(logger, "warn");
	const { connection, receive, close } = await connect(() => Effect.promise(() => processing.promise));

	try {
		await receive(createAgentMessage("backup.cancelled", { jobId: "job-1", scheduleId: "schedule-1" }));

		for (let index = 0; index < 4; index += 1) {
			await vi.advanceTimersByTimeAsync(15_000);
			await receive(createAgentMessage("heartbeat.pong", { sentAt: Date.now() }));
		}

		expect(close).not.toHaveBeenCalled();
		expect(connection.isReady()).toBe(true);
		expect(warn.mock.calls.some(([message]) => message === "Agent heartbeat timed out")).toBe(false);
		expect(agentsService.markAgentSeen).toHaveBeenCalledTimes(4);
	} finally {
		processing.resolve();
		await Effect.runPromise(connection.close("test_finished"));
	}
});

test("invalid pongs do not refresh liveness", async () => {
	const { connection, receive, close } = await connect();

	try {
		await vi.advanceTimersByTimeAsync(30_000);
		await receive(JSON.stringify({ type: "heartbeat.pong", payload: { sentAt: "invalid" } }));
		await vi.advanceTimersByTimeAsync(15_000);

		expect(agentsService.markAgentSeen).not.toHaveBeenCalled();
		expect(close).toHaveBeenCalledWith(1001, "heartbeat_timeout");
	} finally {
		await Effect.runPromise(connection.close("test_finished"));
	}
});

test("shutdown finishes the in-flight heartbeat write and discards pending updates before retiring", async () => {
	const persistence = Promise.withResolvers<void>();
	agentsService.markAgentSeen.mockReturnValueOnce(persistence.promise);
	const { connection, receive, onClosed } = await connect();

	try {
		await receive(createAgentMessage("heartbeat.pong", { sentAt: Date.now() }));
		await vi.advanceTimersByTimeAsync(15_000);
		await receive(createAgentMessage("heartbeat.pong", { sentAt: Date.now() }));

		const closed = Effect.runPromise(connection.close("test_finished"));
		await vi.advanceTimersByTimeAsync(0);

		expect(onClosed).not.toHaveBeenCalled();

		persistence.resolve();
		await closed;

		expect(agentsService.markAgentSeen).toHaveBeenCalledOnce();
		expect(onClosed).toHaveBeenCalledOnce();
	} finally {
		persistence.resolve();
		await Effect.runPromise(connection.close("test_finished"));
	}
});

test("timeout diagnostics distinguish stalled persistence from missing replies without logging payloads", async () => {
	const persistence = Promise.withResolvers<void>();
	const warn = vi.spyOn(logger, "warn");
	agentsService.markAgentSeen.mockReturnValueOnce(persistence.promise);
	const { connection, receive } = await connect();

	try {
		const sentAt = Date.now();

		await receive(createAgentMessage("heartbeat.pong", { sentAt }));
		await receive('{"token":"secret-log-regression"}');
		await vi.advanceTimersByTimeAsync(45_000);

		const timeout = warn.mock.calls.find(([message]) => message === "Agent heartbeat timed out");

		expect(timeout).toBeDefined();
		expect(JSON.parse(String(timeout?.[1]))).toMatchObject({
			pongsProcessed: 1,
			lastPongToken: sentAt,
			heartbeatPersistenceMs: 45_000,
			pendingHeartbeatUpdates: 0,
			inboundQueuedMessages: 0,
			processingMessageType: null,
		});
		expect(JSON.stringify(timeout)).not.toContain("secret-log-regression");
	} finally {
		persistence.resolve();
		await Effect.runPromise(connection.close("test_finished"));
	}
});
