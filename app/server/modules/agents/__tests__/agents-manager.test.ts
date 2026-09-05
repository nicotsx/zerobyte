import { createAgentRuntimeState } from "../helpers/runtime-state";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Effect } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fromAny } from "@total-typescript/shoehorn";
import type { ProcessWithAgentRuntime } from "../helpers/runtime-state.dev";

const spawnMock = vi.fn();
const deriveLocalAgentTokenMock = vi.fn(async () => "local-agent-token");

vi.mock("node:child_process", async () => {
	return { spawn: spawnMock };
});

vi.mock("../helpers/tokens", () => ({ deriveLocalAgentToken: deriveLocalAgentTokenMock }));

let startLocalAgent: (typeof import("../agents-manager"))["startLocalAgent"];
let stopLocalAgent: (typeof import("../agents-manager"))["stopLocalAgent"];
let stopAgentController: (typeof import("../agents-manager"))["stopAgentController"];

const processWithAgentRuntime = process as ProcessWithAgentRuntime;

const deferred = <Value>() => {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
};

const setAgentRuntime = () => {
	processWithAgentRuntime.__zerobyteAgentRuntime = {
		...createAgentRuntimeState(),
		agentManager: fromAny({
			stop: Effect.void,
			getControllerUrl: vi.fn(() => "ws://127.0.0.1:4567"),
			waitForAgentReady: vi.fn(async () => true),
		}),
		localAgent: null,
		isStoppingLocalAgent: false,
		localAgentRestartTimeout: null,
	};
};

type FakeChildProcess = EventEmitter & {
	stdout: PassThrough;
	stderr: PassThrough;
	exitCode: number | null;
	signalCode: NodeJS.Signals | null;
	kill: ReturnType<typeof vi.fn>;
};

const createFakeChild = () => {
	const child = new EventEmitter() as FakeChildProcess;

	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.exitCode = null;
	child.signalCode = null;
	child.kill = vi.fn(() => {
		child.exitCode = 0;
		child.emit("exit", 0, null);
		return true;
	});

	return child;
};

beforeEach(async () => {
	vi.resetModules();
	deriveLocalAgentTokenMock.mockReset();
	deriveLocalAgentTokenMock.mockResolvedValue("local-agent-token");
	setAgentRuntime();
	({ startLocalAgent, stopAgentController, stopLocalAgent } = await import("../agents-manager"));
});

afterEach(async () => {
	await stopLocalAgent();
	await stopAgentController();
	delete processWithAgentRuntime.__zerobyteAgentRuntime;
	spawnMock.mockReset();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

test("respawns the local agent after an unexpected exit", async () => {
	vi.useFakeTimers();

	const firstChild = createFakeChild();
	const secondChild = createFakeChild();
	spawnMock.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);

	await startLocalAgent();

	firstChild.exitCode = 1;
	firstChild.emit("exit", 1, null);

	await vi.advanceTimersByTimeAsync(1_000);

	expect(spawnMock).toHaveBeenCalledTimes(2);
	expect(spawnMock).toHaveBeenLastCalledWith(
		"bun",
		expect.any(Array),
		expect.objectContaining({
			env: expect.objectContaining({ ZEROBYTE_CONTROLLER_URL: "ws://127.0.0.1:4567" }),
		}),
	);
});

test("does not respawn the local agent after an intentional stop", async () => {
	vi.useFakeTimers();

	const child = createFakeChild();
	spawnMock.mockReturnValue(child);

	await startLocalAgent();
	await stopLocalAgent();

	await vi.advanceTimersByTimeAsync(1_000);

	expect(spawnMock).toHaveBeenCalledTimes(1);
	expect(child.kill).toHaveBeenCalledTimes(1);
});

test("shares local agent exit cleanup across a module reload", async () => {
	vi.useFakeTimers();

	const child = createFakeChild();
	spawnMock.mockReturnValue(child);

	await startLocalAgent();
	const runtimeBeforeReload = processWithAgentRuntime.__zerobyteAgentRuntime;
	const managerBeforeReload = runtimeBeforeReload?.agentManager;
	expect(child.listenerCount("exit")).toBe(1);

	vi.resetModules();
	const reloadedManagerModule = await import("../agents-manager");
	const managerAfterReload = reloadedManagerModule.getAgentManagerRuntime();
	const runtimeAfterReload = processWithAgentRuntime.__zerobyteAgentRuntime;

	expect(runtimeAfterReload).toBe(runtimeBeforeReload);
	expect(managerAfterReload).toBe(managerBeforeReload);
	expect(child.listenerCount("exit")).toBe(1);
	expect(spawnMock).toHaveBeenCalledOnce();

	child.exitCode = 1;
	child.emit("exit", 1, null);
	await reloadedManagerModule.stopLocalAgent();
	await vi.advanceTimersByTimeAsync(1_000);

	expect(runtimeAfterReload?.localAgent).toBeNull();
	expect(runtimeAfterReload?.localAgentRestartTimeout).toBeNull();
	expect(spawnMock).toHaveBeenCalledOnce();
});

test("waits for confirmed local agent exit after forcing shutdown", async () => {
	vi.useFakeTimers();
	const child = createFakeChild();
	child.kill.mockImplementation(() => true);
	spawnMock.mockReturnValue(child);

	await startLocalAgent();
	let stopped = false;
	const stopping = stopLocalAgent();
	void stopping.then(() => {
		stopped = true;
	});
	await vi.advanceTimersByTimeAsync(5_000);

	expect(child.kill).toHaveBeenNthCalledWith(1);
	expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
	expect(stopped).toBe(false);

	child.exitCode = 137;
	child.emit("exit", 137, "SIGKILL");
	await stopping;

	expect(stopped).toBe(true);
});

test("does not replace a healthy local agent on adjacent ensure calls", async () => {
	const child = createFakeChild();
	spawnMock.mockReturnValue(child);

	await Promise.all([startLocalAgent(), startLocalAgent()]);

	expect(spawnMock).toHaveBeenCalledOnce();
	expect(processWithAgentRuntime.__zerobyteAgentRuntime?.localAgent).toBe(child);
});

test("serializes starts from two module generations and publishes one child", async () => {
	const tokenBarrier = deferred<string>();
	const child = createFakeChild();
	deriveLocalAgentTokenMock.mockReturnValueOnce(tokenBarrier.promise);
	spawnMock.mockReturnValue(child);

	const firstStart = startLocalAgent();
	await vi.waitFor(() => expect(deriveLocalAgentTokenMock).toHaveBeenCalledOnce());
	vi.resetModules();
	const reloadedManagerModule = await import("../agents-manager");
	const secondStart = reloadedManagerModule.startLocalAgent();

	tokenBarrier.resolve("local-agent-token");
	await Promise.all([firstStart, secondStart]);

	expect(spawnMock).toHaveBeenCalledOnce();
	expect(processWithAgentRuntime.__zerobyteAgentRuntime?.localAgent).toBe(child);
});

test("kills a child spawned after stop invalidates its generation", async () => {
	const tokenBarrier = deferred<string>();
	const child = createFakeChild();
	deriveLocalAgentTokenMock.mockReturnValueOnce(tokenBarrier.promise);
	spawnMock.mockReturnValue(child);

	const starting = startLocalAgent();
	await vi.waitFor(() => expect(deriveLocalAgentTokenMock).toHaveBeenCalledOnce());
	const stopping = stopLocalAgent();
	tokenBarrier.resolve("local-agent-token");
	await Promise.all([starting, stopping]);

	expect(spawnMock).toHaveBeenCalledOnce();
	expect(child.kill).toHaveBeenCalledOnce();
	expect(processWithAgentRuntime.__zerobyteAgentRuntime?.localAgent).toBeNull();
});

test("ignores a stale exit callback after stop and restart", async () => {
	vi.useFakeTimers();
	const firstChild = createFakeChild();
	const secondChild = createFakeChild();
	spawnMock.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);

	await startLocalAgent();
	await stopLocalAgent();
	await startLocalAgent();
	firstChild.emit("exit", 1, null);
	await vi.advanceTimersByTimeAsync(1_000);

	expect(spawnMock).toHaveBeenCalledTimes(2);
	expect(processWithAgentRuntime.__zerobyteAgentRuntime?.localAgent).toBe(secondChild);
	expect(processWithAgentRuntime.__zerobyteAgentRuntime?.localAgentRestartTimeout).toBeNull();
});

test("orders start stop start while the first spawn is delayed", async () => {
	const tokenBarrier = deferred<string>();
	const orphanedChild = createFakeChild();
	const currentChild = createFakeChild();
	deriveLocalAgentTokenMock.mockReturnValueOnce(tokenBarrier.promise).mockResolvedValueOnce("local-agent-token");
	spawnMock.mockReturnValueOnce(orphanedChild).mockReturnValueOnce(currentChild);

	const firstStart = startLocalAgent();
	await vi.waitFor(() => expect(deriveLocalAgentTokenMock).toHaveBeenCalledOnce());
	const stop = stopLocalAgent();
	const secondStart = startLocalAgent();
	tokenBarrier.resolve("local-agent-token");
	await Promise.all([firstStart, stop, secondStart]);

	expect(spawnMock).toHaveBeenCalledTimes(2);
	expect(orphanedChild.kill).toHaveBeenCalledOnce();
	expect(processWithAgentRuntime.__zerobyteAgentRuntime?.localAgent).toBe(currentChild);
});

test("controller stop fences a delayed local-agent spawn and terminates the orphan", async () => {
	const tokenBarrier = deferred<string>();
	const child = createFakeChild();
	deriveLocalAgentTokenMock.mockReturnValueOnce(tokenBarrier.promise);
	spawnMock.mockReturnValue(child);

	const starting = startLocalAgent();
	await vi.waitFor(() => expect(deriveLocalAgentTokenMock).toHaveBeenCalledOnce());
	let controllerStopped = false;
	const stoppingController = stopAgentController();
	void stoppingController.then(() => {
		controllerStopped = true;
	});
	await Promise.resolve();

	expect(controllerStopped).toBe(false);
	tokenBarrier.resolve("local-agent-token");
	await Promise.all([starting, stoppingController]);
	expect(controllerStopped).toBe(true);
	expect(child.kill).toHaveBeenCalledOnce();
	expect(processWithAgentRuntime.__zerobyteAgentRuntime?.localAgentDesiredRunning).toBe(false);
	expect(processWithAgentRuntime.__zerobyteAgentRuntime?.localAgent).toBeNull();
});

test("controller stop terminates a healthy local agent and a later start publishes a fresh child", async () => {
	const firstChild = createFakeChild();
	const secondChild = createFakeChild();
	spawnMock.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);

	await startLocalAgent();
	await Promise.all([stopAgentController(), stopAgentController()]);

	expect(firstChild.kill).toHaveBeenCalledOnce();
	expect(processWithAgentRuntime.__zerobyteAgentRuntime?.localAgent).toBeNull();

	processWithAgentRuntime.__zerobyteAgentRuntime!.agentManager = fromAny({
		stop: Effect.void,
		getControllerUrl: vi.fn(() => "ws://127.0.0.1:5678"),
		waitForAgentReady: vi.fn(async () => true),
	});
	await startLocalAgent();

	expect(spawnMock).toHaveBeenCalledTimes(2);
	expect(spawnMock).toHaveBeenLastCalledWith(
		"bun",
		expect.any(Array),
		expect.objectContaining({
			env: expect.objectContaining({ ZEROBYTE_CONTROLLER_URL: "ws://127.0.0.1:5678" }),
		}),
	);
	expect(processWithAgentRuntime.__zerobyteAgentRuntime?.localAgent).toBe(secondChild);
});

test("controller stop clears a scheduled restart and ignores the stale exit callback", async () => {
	vi.useFakeTimers();
	const child = createFakeChild();
	spawnMock.mockReturnValue(child);

	await startLocalAgent();
	child.exitCode = 1;
	child.emit("exit", 1, null);
	await vi.advanceTimersByTimeAsync(0);
	expect(processWithAgentRuntime.__zerobyteAgentRuntime?.localAgentRestartTimeout).not.toBeNull();

	await stopAgentController();
	await vi.advanceTimersByTimeAsync(1_000);

	expect(spawnMock).toHaveBeenCalledOnce();
	expect(processWithAgentRuntime.__zerobyteAgentRuntime?.localAgentRestartTimeout).toBeNull();
	expect(processWithAgentRuntime.__zerobyteAgentRuntime?.localAgentDesiredRunning).toBe(false);
});
