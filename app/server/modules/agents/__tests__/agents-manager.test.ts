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
let startAgentController: (typeof import("../agents-manager"))["startAgentController"];
let stopLocalAgent: (typeof import("../agents-manager"))["stopLocalAgent"];
let stopAgentController: (typeof import("../agents-manager"))["stopAgentController"];
let config: (typeof import("~/server/core/config"))["config"];
let originalEnableLocalAgent: boolean;

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
	({ config } = await import("~/server/core/config"));
	originalEnableLocalAgent = config.flags.enableLocalAgent;
	config.flags.enableLocalAgent = true;
	setAgentRuntime();
	({ startAgentController, startLocalAgent, stopAgentController, stopLocalAgent } =
		await import("../agents-manager"));
});

afterEach(async () => {
	await stopLocalAgent();
	await stopAgentController();
	config.flags.enableLocalAgent = originalEnableLocalAgent;
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

test("does not start the websocket server when the local agent flag is disabled", async () => {
	config.flags.enableLocalAgent = false;
	const serve = vi.spyOn(Bun, "serve");

	await startAgentController();

	expect(serve).not.toHaveBeenCalled();
	expect(processWithAgentRuntime.__zerobyteAgentRuntime?.agentManager).toBeNull();
});
