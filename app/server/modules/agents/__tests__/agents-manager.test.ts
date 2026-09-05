import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Effect } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { createAgentRuntimeState } from "../helpers/runtime-state";
import type { ProcessWithAgentRuntime } from "../helpers/runtime-state.dev";

const spawnMock = vi.fn();
const deriveLocalAgentTokenMock = vi.fn(async () => "local-agent-token");

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
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

const createFakeChild = () => {
	const child = Object.assign(new EventEmitter(), {
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		exitCode: null as number | null,
		signalCode: null as NodeJS.Signals | null,
		kill: vi.fn((_signal?: NodeJS.Signals) => {
			child.exitCode = 0;
			child.emit("exit", 0, null);
			return true;
		}),
	});

	return child;
};

const controller = () => processWithAgentRuntime.__zerobyteAgentRuntime!.agentManager!;

beforeEach(async () => {
	vi.resetModules();
	deriveLocalAgentTokenMock.mockReset();
	deriveLocalAgentTokenMock.mockResolvedValue("local-agent-token");
	processWithAgentRuntime.__zerobyteAgentRuntime = {
		...createAgentRuntimeState(),
		agentManager: fromPartial({
			stop: Effect.void,
			getControllerUrl: vi.fn(() => "ws://127.0.0.1:4567"),
			waitForAgentReady: vi.fn(async () => true),
		}),
	};
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
			env: expect.objectContaining({
				ZEROBYTE_CONTROLLER_URL: "ws://127.0.0.1:4567",
				ZEROBYTE_BUILTIN_LOCAL_AGENT: "1",
			}),
			stdio: ["pipe", "pipe", "pipe"],
		}),
	);
});

test("retries automatic replacements after readiness and spawn failures", async () => {
	vi.useFakeTimers();

	const firstChild = createFakeChild();
	const secondChild = createFakeChild();
	const thirdChild = createFakeChild();
	vi.mocked(controller().waitForAgentReady)
		.mockResolvedValueOnce(true)
		.mockResolvedValueOnce(false)
		.mockResolvedValueOnce(true);
	spawnMock
		.mockReturnValueOnce(firstChild)
		.mockReturnValueOnce(secondChild)
		.mockImplementationOnce(() => {
			throw new Error("spawn failed");
		})
		.mockReturnValueOnce(thirdChild);

	await startLocalAgent();
	firstChild.exitCode = 1;
	firstChild.emit("exit", 1, null);
	await vi.advanceTimersByTimeAsync(1_000);

	expect(secondChild.kill).toHaveBeenCalledOnce();
	await vi.advanceTimersByTimeAsync(2_000);

	expect(spawnMock).toHaveBeenCalledTimes(4);
	expect(thirdChild.kill).not.toHaveBeenCalled();
});

test("stopping cancels a pending automatic restart", async () => {
	vi.useFakeTimers();

	const child = createFakeChild();
	spawnMock.mockReturnValue(child);
	await startLocalAgent();
	child.exitCode = 1;
	child.emit("exit", 1, null);
	await vi.advanceTimersByTimeAsync(0);

	await stopLocalAgent();
	await vi.advanceTimersByTimeAsync(2_000);

	expect(spawnMock).toHaveBeenCalledOnce();
});

test("does not respawn after an intentional stop", async () => {
	vi.useFakeTimers();

	const child = createFakeChild();
	spawnMock.mockReturnValue(child);
	await startLocalAgent();
	await Promise.all([stopLocalAgent(), stopLocalAgent()]);
	await vi.advanceTimersByTimeAsync(2_000);

	expect(spawnMock).toHaveBeenCalledOnce();
	expect(child.kill).toHaveBeenCalledOnce();
});

test("waits for confirmed exit after forcing shutdown", async () => {
	vi.useFakeTimers();

	const child = createFakeChild();
	child.kill.mockImplementation(() => true);
	spawnMock.mockReturnValue(child);
	await startLocalAgent();

	let stopped = false;
	const stopping = stopLocalAgent().then(() => {
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

test.each(["exit", "close"])(
	"does not replace an unconfirmed worker after shutdown timeout and late %s",
	async (event) => {
		vi.useFakeTimers();

		const child = createFakeChild();
		const replacement = createFakeChild();
		child.kill.mockImplementation(() => true);
		spawnMock.mockReturnValueOnce(child).mockReturnValueOnce(replacement);
		await startLocalAgent();

		const stopping = expect(stopLocalAgent()).rejects.toThrow("termination was not confirmed after SIGKILL");
		await vi.advanceTimersByTimeAsync(10_000);
		await stopping;

		const starting = expect(startLocalAgent()).rejects.toThrow("termination was not confirmed after SIGKILL");
		await vi.advanceTimersByTimeAsync(10_000);
		await starting;
		expect(spawnMock).toHaveBeenCalledOnce();

		child.exitCode = 137;
		child.emit(event, 137, "SIGKILL");
		await vi.advanceTimersByTimeAsync(2_000);
		expect(spawnMock).toHaveBeenCalledOnce();

		await startLocalAgent();
		expect(spawnMock).toHaveBeenCalledTimes(2);
	},
);

test("shares pending startup and the supervisor across module reloads", async () => {
	const token = deferred<string>();
	const child = createFakeChild();
	deriveLocalAgentTokenMock.mockReturnValueOnce(token.promise);
	spawnMock.mockReturnValue(child);

	const firstStart = startLocalAgent();
	await vi.waitFor(() => expect(deriveLocalAgentTokenMock).toHaveBeenCalledOnce());
	vi.resetModules();
	const reloaded = await import("../agents-manager");
	const secondStart = reloaded.startLocalAgent();
	token.resolve("local-agent-token");
	await Promise.all([firstStart, secondStart]);
	await reloaded.startLocalAgent();

	expect(spawnMock).toHaveBeenCalledOnce();
	await reloaded.stopLocalAgent();
	expect(child.kill).toHaveBeenCalledOnce();
});

test.each([false, true])(
	"shutdown cancels delayed token generation without spawning (reloaded: %s)",
	async (reload) => {
		const token = deferred<string>();
		deriveLocalAgentTokenMock.mockReturnValueOnce(token.promise);

		const starting = expect(startLocalAgent()).rejects.toThrow("startup was interrupted by shutdown");
		await vi.waitFor(() => expect(deriveLocalAgentTokenMock).toHaveBeenCalledOnce());
		if (reload) vi.resetModules();
		const stop = reload ? (await import("../agents-manager")).stopLocalAgent : stopLocalAgent;
		await stop();
		await starting;

		token.resolve("local-agent-token");
		await Promise.resolve();
		expect(spawnMock).not.toHaveBeenCalled();
	},
);

test.each(["not-ready", "readiness-error", "exit"])("cleans up failed initial startup: %s", async (mode) => {
	const child = createFakeChild();
	spawnMock.mockReturnValue(child);
	if (mode === "not-ready") vi.mocked(controller().waitForAgentReady).mockResolvedValueOnce(false);
	if (mode === "readiness-error")
		vi.mocked(controller().waitForAgentReady).mockRejectedValueOnce(new Error("readiness failed"));
	if (mode === "exit") {
		vi.mocked(controller().waitForAgentReady).mockImplementationOnce(async () => {
			child.exitCode = 1;
			child.emit("exit", 1, null);
			return false;
		});
	}

	await expect(startLocalAgent()).rejects.toThrow();
	expect(child.exitCode).not.toBeNull();
	await stopLocalAgent();
	expect(spawnMock).toHaveBeenCalledOnce();
});

test("shutdown interrupts readiness and terminates the worker", async () => {
	const readiness = deferred<boolean>();
	const child = createFakeChild();
	spawnMock.mockReturnValue(child);
	vi.mocked(controller().waitForAgentReady).mockReturnValueOnce(readiness.promise);

	const starting = expect(startLocalAgent()).rejects.toThrow("startup was interrupted by shutdown");
	await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
	await stopLocalAgent();
	await starting;

	readiness.resolve(true);
	expect(child.kill).toHaveBeenCalledOnce();
});

test("orders start stop start while token generation is delayed", async () => {
	const token = deferred<string>();
	const child = createFakeChild();
	deriveLocalAgentTokenMock.mockReturnValueOnce(token.promise);
	spawnMock.mockReturnValue(child);

	const firstStart = expect(startLocalAgent()).rejects.toThrow("startup was interrupted by shutdown");
	await vi.waitFor(() => expect(deriveLocalAgentTokenMock).toHaveBeenCalledOnce());
	const stop = stopLocalAgent();
	const secondStart = startLocalAgent();
	await Promise.all([firstStart, stop, secondStart]);
	token.resolve("local-agent-token");

	expect(spawnMock).toHaveBeenCalledOnce();
	expect(child.kill).not.toHaveBeenCalled();
});

test("ignores a stale exit after stop and restart", async () => {
	vi.useFakeTimers();

	const firstChild = createFakeChild();
	const secondChild = createFakeChild();
	spawnMock.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
	await startLocalAgent();
	await stopLocalAgent();
	await startLocalAgent();
	firstChild.emit("exit", 1, null);
	await vi.advanceTimersByTimeAsync(2_000);

	expect(spawnMock).toHaveBeenCalledTimes(2);
	expect(secondChild.kill).not.toHaveBeenCalled();
});

test("controller shutdown cancels startup and a later controller uses its current URL", async () => {
	const token = deferred<string>();
	const child = createFakeChild();
	deriveLocalAgentTokenMock.mockReturnValueOnce(token.promise);
	spawnMock.mockReturnValue(child);

	const starting = expect(startLocalAgent()).rejects.toThrow("startup was interrupted by shutdown");
	await vi.waitFor(() => expect(deriveLocalAgentTokenMock).toHaveBeenCalledOnce());
	await Promise.all([stopAgentController(), stopAgentController()]);
	await starting;
	token.resolve("local-agent-token");

	processWithAgentRuntime.__zerobyteAgentRuntime!.agentManager = fromPartial({
		stop: Effect.void,
		getControllerUrl: () => "ws://127.0.0.1:5678",
		waitForAgentReady: async () => true,
	});
	await startLocalAgent();

	expect(spawnMock).toHaveBeenCalledOnce();
	expect(spawnMock).toHaveBeenLastCalledWith(
		"bun",
		expect.any(Array),
		expect.objectContaining({
			env: expect.objectContaining({ ZEROBYTE_CONTROLLER_URL: "ws://127.0.0.1:5678" }),
		}),
	);
});

test.each(["controller", "url"])("rejects startup without a running %s", async (missing) => {
	if (missing === "controller") {
		processWithAgentRuntime.__zerobyteAgentRuntime!.agentManager = null;
	} else {
		vi.mocked(controller().getControllerUrl).mockReturnValue(null);
	}

	await expect(startLocalAgent()).rejects.toThrow("startLocalAgent cannot spawn");
	expect(spawnMock).not.toHaveBeenCalled();
});

test("controller shutdown still closes the controller when worker termination times out", async () => {
	vi.useFakeTimers();

	const child = createFakeChild();
	child.kill.mockImplementation(() => true);
	const stoppedController = vi.fn();
	controller().stop = Effect.sync(stoppedController);
	spawnMock.mockReturnValue(child);
	await startLocalAgent();

	const stopping = expect(stopAgentController()).rejects.toThrow("termination was not confirmed after SIGKILL");
	await vi.advanceTimersByTimeAsync(10_000);
	await stopping;

	expect(stoppedController).toHaveBeenCalledOnce();
	child.exitCode = 137;
	child.emit("exit", 137, "SIGKILL");
	await vi.advanceTimersByTimeAsync(2_000);
	expect(spawnMock).toHaveBeenCalledOnce();
});

test("reports both worker and controller shutdown failures", async () => {
	vi.useFakeTimers();

	const child = createFakeChild();
	child.kill.mockImplementation(() => true);
	controller().stop = Effect.die(new Error("controller stop failed"));
	spawnMock.mockReturnValue(child);
	await startLocalAgent();

	const stopping = expect(stopAgentController()).rejects.toMatchObject({
		name: "AggregateError",
		errors: [
			expect.objectContaining({ message: "Local agent termination was not confirmed after SIGKILL" }),
			expect.objectContaining({ message: "controller stop failed" }),
		],
	});
	await vi.advanceTimersByTimeAsync(10_000);
	await stopping;

	child.exitCode = 137;
	child.emit("exit", 137, "SIGKILL");
});

test("handles an asynchronous spawn error and permits a later startup", async () => {
	const failedChild = createFakeChild();
	const healthyChild = createFakeChild();
	spawnMock
		.mockImplementationOnce(() => {
			queueMicrotask(() => {
				failedChild.emit("error", new Error("spawn ENOENT"));
				failedChild.exitCode = -2;
				failedChild.emit("close", -2, null);
			});
			return failedChild;
		})
		.mockReturnValueOnce(healthyChild);

	await expect(startLocalAgent()).rejects.toThrow("spawn ENOENT");
	await startLocalAgent();

	expect(spawnMock).toHaveBeenCalledTimes(2);
	expect(healthyChild.kill).not.toHaveBeenCalled();
});

test("shutdown terminates an automatic replacement whose readiness is pending", async () => {
	vi.useFakeTimers();

	const firstChild = createFakeChild();
	const secondChild = createFakeChild();
	const readiness = deferred<boolean>();
	vi.mocked(controller().waitForAgentReady).mockResolvedValueOnce(true).mockReturnValueOnce(readiness.promise);
	spawnMock.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
	await startLocalAgent();
	firstChild.exitCode = 1;
	firstChild.emit("exit", 1, null);
	await vi.advanceTimersByTimeAsync(1_000);

	await stopLocalAgent();
	readiness.resolve(true);
	await vi.advanceTimersByTimeAsync(2_000);

	expect(secondChild.kill).toHaveBeenCalledOnce();
	expect(spawnMock).toHaveBeenCalledTimes(2);
});

test("an ensure call waits for a restarting worker to become ready", async () => {
	vi.useFakeTimers();

	const firstChild = createFakeChild();
	const secondChild = createFakeChild();
	const readiness = deferred<boolean>();
	vi.mocked(controller().waitForAgentReady).mockResolvedValueOnce(true).mockReturnValueOnce(readiness.promise);
	spawnMock.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
	await startLocalAgent();
	firstChild.exitCode = 1;
	firstChild.emit("exit", 1, null);

	let ready = false;
	const ensuring = startLocalAgent().then(() => {
		ready = true;
	});
	await vi.advanceTimersByTimeAsync(1_000);
	expect(spawnMock).toHaveBeenCalledTimes(2);
	expect(ready).toBe(false);

	readiness.resolve(true);
	await ensuring;
	expect(ready).toBe(true);
});
