import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Effect } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fromAny } from "@total-typescript/shoehorn";
import type { ProcessWithAgentRuntime } from "../helpers/runtime-state.dev";

const spawnMock = vi.fn();

vi.mock("node:child_process", async () => {
	return { spawn: spawnMock };
});

let startLocalAgent: (typeof import("../agents-manager"))["startLocalAgent"];
let stopLocalAgent: (typeof import("../agents-manager"))["stopLocalAgent"];
let stopAgentController: (typeof import("../agents-manager"))["stopAgentController"];

const processWithAgentRuntime = process as ProcessWithAgentRuntime;

const setAgentRuntime = () => {
	processWithAgentRuntime.__zerobyteAgentRuntime = {
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

test("does not spawn a replacement when forced termination cannot be confirmed", async () => {
	vi.useFakeTimers();
	const child = createFakeChild();
	child.kill.mockImplementation(() => true);
	spawnMock.mockReturnValue(child);

	await startLocalAgent();
	const replacement = startLocalAgent();
	const replacementFailure = expect(replacement).rejects.toThrow(
		"Local agent termination was not confirmed after SIGKILL",
	);
	await vi.advanceTimersByTimeAsync(10_000);
	await replacementFailure;

	expect(spawnMock).toHaveBeenCalledTimes(1);

	child.exitCode = 137;
	child.emit("exit", 137, "SIGKILL");
});
