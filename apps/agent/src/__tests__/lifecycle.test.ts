import { Effect, Exit, Fiber } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	closeSession: vi.fn(),
	onOpen: vi.fn(),
	onMessage: vi.fn(),
	loggerError: vi.fn(),
	startAgentJobs: vi.fn<() => Fiber.RuntimeFiber<never, never>[]>(() => []),
}));

vi.mock("../controller-session", () => ({
	createControllerSession: vi.fn(() => ({
		close: mocks.closeSession,
		onOpen: mocks.onOpen,
		onMessage: mocks.onMessage,
	})),
}));
vi.mock("../jobs", () => ({ startAgentJobs: mocks.startAgentJobs }));
vi.mock("../trusted-roots", () => ({ getDefaultTrustedRootRegistry: vi.fn(() => new Map()) }));
vi.mock("@zerobyte/core/node", () => ({
	logger: { info: vi.fn(), error: mocks.loggerError },
}));

type SocketOptions = { headers: { authorization: string } };

class TestWebSocket {
	static instances: TestWebSocket[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	close = vi.fn();

	constructor(
		readonly url: string,
		readonly options: SocketOptions,
	) {
		TestWebSocket.instances.push(this);
	}
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(Math, "random").mockReturnValue(0.5);
	vi.stubEnv("ZEROBYTE_BUILTIN_LOCAL_AGENT", "0");
	vi.stubGlobal("WebSocket", TestWebSocket);
	TestWebSocket.instances = [];
	mocks.closeSession.mockReset();
	mocks.onOpen.mockReset();
	mocks.onMessage.mockReset();
	mocks.loggerError.mockReset();
	mocks.startAgentJobs.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

test("uses an authorization header and never places the enrollment token in the URL", async () => {
	const { Agent } = await import("../index");
	const token = "zba1.secret-material";
	const agent = new Agent("ws://127.0.0.1:4096/api/v1/agents/connect", token);
	agent.connect();

	const socket = TestWebSocket.instances[0];
	expect(socket?.url).toBe("ws://127.0.0.1:4096/api/v1/agents/connect");
	expect(socket?.url).not.toContain(token);
	expect(socket?.options.headers.authorization).toBe(`Bearer ${token}`);
	socket?.onerror?.();
	expect(mocks.loggerError).toHaveBeenCalledWith("Agent websocket connection failed");
	expect(JSON.stringify(mocks.loggerError.mock.calls)).not.toContain(token);
	agent.stop();
});

test.each([
	"ws://remote.example/api/v1/agents/connect",
	"http://remote.example/api/v1/agents/connect",
	"ws://localhost.example/api/v1/agents/connect",
	"ws://127.0.0.1.example/api/v1/agents/connect",
	"ws://[::2]/api/v1/agents/connect",
])("rejects insecure non-loopback controller URL %s before sending credentials", async (controllerUrl) => {
	const { Agent } = await import("../index");
	const agent = new Agent(controllerUrl, "secret-token");

	expect(() => agent.connect()).toThrow("require a wss:// controller URL");
	expect(TestWebSocket.instances).toHaveLength(0);
});

test.each([
	"ws://localhost/api/v1/agents/connect",
	"ws://127.0.0.1:4096/api/v1/agents/connect",
	"ws://[::1]:4096/api/v1/agents/connect",
	"wss://remote.example/api/v1/agents/connect",
])("allows secure or exact loopback controller URL %s without NODE_ENV", async (controllerUrl) => {
	const { Agent } = await import("../index");
	const agent = new Agent(controllerUrl, "token");

	agent.connect();

	expect(TestWebSocket.instances[0]?.url).toBe(controllerUrl);
	agent.stop();
});

test("reconnects with one exponential timer, resets after open, and stops cleanly", async () => {
	const { Agent } = await import("../index");
	const agent = new Agent("ws://127.0.0.1:4096/api/v1/agents/connect", "token");
	agent.connect();
	const first = TestWebSocket.instances[0];
	first?.onclose?.();
	first?.onclose?.();

	await vi.advanceTimersByTimeAsync(999);
	expect(TestWebSocket.instances).toHaveLength(1);
	await vi.advanceTimersByTimeAsync(1);
	expect(TestWebSocket.instances).toHaveLength(2);

	const second = TestWebSocket.instances[1];
	second?.onopen?.();
	second?.onclose?.();
	await vi.advanceTimersByTimeAsync(1_000);
	expect(TestWebSocket.instances).toHaveLength(3);

	const third = TestWebSocket.instances[2];
	agent.stop();
	third?.onclose?.();
	await vi.advanceTimersByTimeAsync(60_000);
	expect(TestWebSocket.instances).toHaveLength(3);
	expect(third?.close).toHaveBeenCalledWith(1000, "agent_shutdown");
});

test("ignores stale callbacks from a socket closed during an immediate restart", async () => {
	const { Agent } = await import("../index");
	const agent = new Agent("ws://127.0.0.1:4096/api/v1/agents/connect", "token");
	agent.connect();
	const first = TestWebSocket.instances[0];

	agent.stop();
	agent.connect();
	const second = TestWebSocket.instances[1];
	first?.onclose?.();
	second?.onopen?.();

	expect(mocks.onOpen).toHaveBeenCalledTimes(1);
	expect(TestWebSocket.instances).toHaveLength(2);
	agent.stop();
});

test("does not schedule managed cleanup for remote agent reconnects", async () => {
	const { Agent } = await import("../index");
	const agent = new Agent("wss://remote.example/api/v1/agents/connect", "token");
	agent.connect();

	const socket = TestWebSocket.instances[0];
	socket?.onclose?.();
	await vi.advanceTimersByTimeAsync(1_000);

	expect(mocks.startAgentJobs).not.toHaveBeenCalled();
	agent.stop();
});

test("starts managed cleanup once for the built-in local agent and stops it", async () => {
	const { Agent } = await import("../index");
	const cleanupFiber = Effect.runFork(Effect.never);
	mocks.startAgentJobs.mockReturnValueOnce([cleanupFiber]);
	vi.stubEnv("ZEROBYTE_BUILTIN_LOCAL_AGENT", "1");
	const agent = new Agent("wss://remote.example/api/v1/agents/connect", "token");
	agent.connect();

	const socket = TestWebSocket.instances[0];
	socket?.onclose?.();
	await vi.advanceTimersByTimeAsync(1_000);

	expect(mocks.startAgentJobs).toHaveBeenCalledTimes(1);
	agent.stop();

	const exit = await Effect.runPromise(Fiber.await(cleanupFiber));
	expect(Exit.isInterrupted(exit)).toBe(true);
});
