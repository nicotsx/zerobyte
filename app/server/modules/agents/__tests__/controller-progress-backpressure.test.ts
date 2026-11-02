import { afterEach, expect, test, vi } from "vitest";
import { Effect } from "effect";
import { AGENT_PROTOCOL_VERSION, createAgentMessage, type AgentMessage } from "@zerobyte/contracts/agent-protocol";
import { createAgentConnection } from "../controller/connection";

const agentsService = vi.hoisted(() => ({
	markAgentConnecting: vi.fn(() => Promise.resolve({ id: "local" })),
	markAgentOnline: vi.fn(() => Promise.resolve()),
	markAgentSeen: vi.fn(() => Promise.resolve()),
}));

vi.mock("../agents.service", () => ({ agentsService }));

afterEach(() => {
	vi.clearAllMocks();
});

const progressMessage = (seconds: number) =>
	createAgentMessage("backup.progress", {
		jobId: "job-1",
		scheduleId: "schedule-1",
		progress: {
			message_type: "status",
			seconds_elapsed: seconds,
			seconds_remaining: 0,
			percent_done: seconds / 100,
			total_files: 100,
			files_done: seconds,
			total_bytes: 100,
			bytes_done: seconds,
			current_files: [],
		},
	});

test("a burst of backup progress preserves the connection, latest progress, heartbeat, and completion", async () => {
	const gate = Promise.withResolvers<void>();
	const events: AgentMessage[] = [];
	const close = vi.fn();
	const connection = createAgentConnection(
		{
			id: "busy-controller",
			agentId: "local",
			agentName: "Local Agent",
			agentKind: "local",
			organizationId: null,
			credentialVersion: 0,
		},
		{ send: () => 1, close },
		{
			onReady: Effect.void,
			onClosed: Effect.void,
			onEvent: (event) =>
				Effect.promise(async () => {
					if (event.type === "agent.protocolRejected") return;

					events.push(event);

					if (event.type === "backup.progress" && event.payload.progress.seconds_elapsed === 0) {
						await gate.promise;
					}
				}),
		},
	);
	const receive = (message: string) => Effect.runPromise(connection.receive(message));

	try {
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
		await vi.waitFor(() => expect(connection.isReady()).toBe(true));

		await receive(progressMessage(0));
		await vi.waitFor(() => expect(events).toHaveLength(1));

		for (let seconds = 1; seconds <= 100; seconds += 1) {
			await receive(progressMessage(seconds));
		}

		await receive(createAgentMessage("heartbeat.pong", { sentAt: 123 }));
		await receive(
			createAgentMessage("backup.completed", {
				jobId: "job-1",
				scheduleId: "schedule-1",
				exitCode: 0,
				result: null,
			}),
		);

		expect(close).not.toHaveBeenCalled();

		gate.resolve();
		await vi.waitFor(() => expect(events.at(-1)?.type).toBe("backup.completed"));

		expect(
			events
				.filter((event) => event.type === "backup.progress")
				.map((event) => event.payload.progress.seconds_elapsed),
		).toEqual([0, 100]);
		expect(agentsService.markAgentSeen).toHaveBeenCalledOnce();
		expect(connection.isReady()).toBe(true);
	} finally {
		gate.resolve();
		await Effect.runPromise(connection.close("test_finished"));
	}
});
