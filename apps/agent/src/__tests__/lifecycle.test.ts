import { Effect, Fiber } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { runAgent, type AgentOptions } from "../agent";
import { createControllerSession } from "../controller-session";
import { createTrustedRootRegistry } from "../trusted-roots";

const mocks = vi.hoisted(() => ({
	closeSession: vi.fn(),
	onOpen: vi.fn(),
	onMessage: vi.fn(),
	loggerError: vi.fn(),
	loggerInfo: vi.fn(),
}));

vi.mock("../controller-session", () => ({
	createControllerSession: vi.fn(() => ({
		close: mocks.closeSession,
		onOpen: mocks.onOpen,
		onMessage: mocks.onMessage,
	})),
}));
vi.mock("../trusted-roots", async (importOriginal) => ({
	...(await importOriginal<typeof import("../trusted-roots")>()),
	createTrustedRootRegistry: vi.fn(() => new Map()),
}));
vi.mock("@zerobyte/core/node", () => ({
	logger: { info: mocks.loggerInfo, error: mocks.loggerError },
}));

class TestWebSocket {
	static instances: TestWebSocket[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: ((event?: { code: number; reason: string }) => void) | null = null;
	onerror: ((event?: { message: string }) => void) | null = null;
	close = vi.fn();

	constructor(
		readonly url: string,
		readonly options: { headers: { authorization: string } },
	) {
		TestWebSocket.instances.push(this);
	}
}

const latestSocket = () => TestWebSocket.instances.at(-1)!;

const options = (overrides: Partial<AgentOptions["configuration"]> = {}): AgentOptions => ({
	configuration: {
		controllerUrl: "wss://controller.example/api/v1/agents/connect",
		token: "zba1.secret-material",
		roots: [],
		...overrides,
	},
	resticVersion: "0.18.1",
	builtinLocal: false,
});

const start = async (agentOptions = options()) => {
	const fiber = Effect.runFork(runAgent(agentOptions));
	await vi.advanceTimersByTimeAsync(0);

	return fiber;
};

/** Jitter scales each delay by 0.8–1.2, so a reconnect must not happen before 80% nor after 120% of it. */
const expectReconnectAfter = async (delayMs: number) => {
	const connections = TestWebSocket.instances.length;

	await vi.advanceTimersByTimeAsync(delayMs * 0.8 - 1);
	expect(TestWebSocket.instances).toHaveLength(connections);
	await vi.advanceTimersByTimeAsync(delayMs * 0.4 + 1);
	expect(TestWebSocket.instances).toHaveLength(connections + 1);
};

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("WebSocket", TestWebSocket);
	TestWebSocket.instances = [];
	vi.clearAllMocks();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

test("authenticates with a header and never logs the credential", async () => {
	const fiber = await start();
	const token = options().configuration.token;
	const socket = latestSocket();

	expect(socket.url).toBe("wss://controller.example/api/v1/agents/connect");
	expect(socket.options.headers.authorization).toBe(`Bearer ${token}`);

	socket.onerror?.({ message: `Expected 101 status code: ${token}` });
	socket.onclose?.({ code: 1002, reason: `Rejected ${token}` });
	await vi.advanceTimersByTimeAsync(0);

	expect(mocks.loggerError).toHaveBeenCalledWith(expect.stringContaining("X-Forwarded-Proto: https"));
	expect(mocks.loggerInfo).toHaveBeenCalledWith(expect.stringContaining("1002: Rejected [redacted]"));
	expect(mocks.loggerInfo).toHaveBeenCalledWith(expect.stringMatching(/^Reconnecting to controller in \d+s$/));
	expect(JSON.stringify([...mocks.loggerError.mock.calls, ...mocks.loggerInfo.mock.calls])).not.toContain(token);

	await Effect.runPromise(Fiber.interrupt(fiber));
});

test("failed connections back off exponentially up to the limit", async () => {
	const fiber = await start();

	for (const delayMs of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
		latestSocket().onclose?.();
		await expectReconnectAfter(delayMs);
	}

	await Effect.runPromise(Fiber.interrupt(fiber));
});

test("an established session restarts backoff from the initial delay", async () => {
	const fiber = await start();

	for (const delayMs of [1_000, 2_000, 4_000]) {
		latestSocket().onclose?.();
		await expectReconnectAfter(delayMs);
	}

	latestSocket().onopen?.();
	latestSocket().onclose?.();
	await expectReconnectAfter(1_000);

	latestSocket().onclose?.();
	await expectReconnectAfter(1_000);

	await Effect.runPromise(Fiber.interrupt(fiber));
});

test("interruption closes the socket and stops reconnecting", async () => {
	const fiber = await start();
	const socket = latestSocket();
	socket.onopen?.();

	await Effect.runPromise(Fiber.interrupt(fiber));
	socket.onclose?.();
	await vi.advanceTimersByTimeAsync(60_000);

	expect(socket.close).toHaveBeenCalledWith(1000, "agent_shutdown");
	expect(mocks.closeSession).toHaveBeenCalled();
	expect(TestWebSocket.instances).toHaveLength(1);
});

test("each connection gets a session with the configured roots and versions", async () => {
	const roots = new Map();
	vi.mocked(createTrustedRootRegistry).mockReturnValueOnce(roots);
	const agentOptions = options({ configPath: "/var/lib/zerobyte-agent/agent.json" });
	const fiber = await start(agentOptions);

	latestSocket().onclose?.();
	await expectReconnectAfter(1_000);

	expect(createTrustedRootRegistry).toHaveBeenCalledOnce();
	expect(createTrustedRootRegistry).toHaveBeenCalledWith({ roots: [], builtinLocal: false });
	expect(createControllerSession).toHaveBeenCalledTimes(2);
	expect(createControllerSession).toHaveBeenLastCalledWith(expect.any(TestWebSocket), {
		resticVersion: "0.18.1",
		trustedRoots: roots,
		builtinLocal: false,
		excludedPaths: ["/var/lib/zerobyte-agent/agent.json"],
	});

	await Effect.runPromise(Fiber.interrupt(fiber));
});
