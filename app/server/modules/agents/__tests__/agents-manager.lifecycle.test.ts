import { logger } from "@zerobyte/core/node";
import { Effect } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fromAny } from "@total-typescript/shoehorn";
import type { ProcessWithAgentRuntime } from "../helpers/runtime-state.dev";

const createAgentManagerRuntime = vi.hoisted(() => vi.fn());

vi.mock("../controller/server", () => ({ createAgentManagerRuntime }));

const processWithAgentRuntime = process as ProcessWithAgentRuntime;

const deferred = <Value>() => {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
};

const createFakeManager = (start: Promise<void>, stop: Promise<void> = Promise.resolve()) =>
	fromAny({
		start: Effect.promise(() => start),
		stop: Effect.promise(() => stop),
	});

beforeEach(() => {
	vi.resetModules();
	createAgentManagerRuntime.mockReset();
	delete processWithAgentRuntime.__zerobyteAgentRuntime;
});

afterEach(async () => {
	const { stopAgentController } = await import("../agents-manager");
	await stopAgentController().catch(() => undefined);
	delete processWithAgentRuntime.__zerobyteAgentRuntime;
	vi.restoreAllMocks();
});

test("linearizes concurrent starts and publishes only one started manager", async () => {
	const starting = deferred<void>();
	const stop = vi.fn(() => Promise.resolve());
	const manager = fromAny({
		start: Effect.promise(() => starting.promise),
		stop: Effect.promise(stop),
	});
	createAgentManagerRuntime.mockReturnValue(manager);
	const { getAgentManagerRuntime, startAgentController, stopAgentController } = await import("../agents-manager");

	const firstStart = startAgentController();
	const secondStart = startAgentController();
	await vi.waitFor(() => expect(createAgentManagerRuntime).toHaveBeenCalledOnce());
	expect(getAgentManagerRuntime()).toBeNull();

	starting.resolve();
	await Promise.all([firstStart, secondStart]);

	expect(createAgentManagerRuntime).toHaveBeenCalledOnce();
	expect(getAgentManagerRuntime()).toBe(manager);

	await Promise.all([stopAgentController(), stopAgentController()]);
	expect(stop).toHaveBeenCalledOnce();
	expect(getAgentManagerRuntime()).toBeNull();
});

test("orders stop during start and a later start by invocation", async () => {
	const firstStarting = deferred<void>();
	const firstStop = vi.fn(() => Promise.resolve());
	const firstManager = fromAny({
		start: Effect.promise(() => firstStarting.promise),
		stop: Effect.promise(firstStop),
	});
	const secondManager = createFakeManager(Promise.resolve());
	createAgentManagerRuntime.mockReturnValueOnce(firstManager).mockReturnValueOnce(secondManager);
	const { getAgentManagerRuntime, startAgentController, stopAgentController } = await import("../agents-manager");

	const start = startAgentController();
	const stop = stopAgentController();
	const restart = startAgentController();
	await vi.waitFor(() => expect(createAgentManagerRuntime).toHaveBeenCalledOnce());
	expect(firstStop).not.toHaveBeenCalled();

	firstStarting.resolve();
	await Promise.all([start, stop, restart]);

	expect(firstStop).toHaveBeenCalledOnce();
	expect(createAgentManagerRuntime).toHaveBeenCalledTimes(2);
	expect(getAgentManagerRuntime()).toBe(secondManager);
});

test("contains start and stop failures so later transitions still run", async () => {
	const startError = new Error("start failed");
	const stopError = new Error("stop failed");
	const failedStart = Promise.reject(startError);
	const failedStop = Promise.reject(stopError);
	void failedStart.catch(() => undefined);
	void failedStop.catch(() => undefined);
	const failedStartManager = createFakeManager(failedStart);
	const failedStopManager = createFakeManager(Promise.resolve(), failedStop);
	const finalManager = createFakeManager(Promise.resolve());
	createAgentManagerRuntime
		.mockReturnValueOnce(failedStartManager)
		.mockReturnValueOnce(failedStopManager)
		.mockReturnValueOnce(finalManager);
	const { getAgentManagerRuntime, startAgentController, stopAgentController } = await import("../agents-manager");

	await expect(startAgentController()).rejects.toThrow("start failed");
	await expect(startAgentController()).resolves.toBeUndefined();
	await expect(stopAgentController()).rejects.toThrow("stop failed");
	await expect(startAgentController()).resolves.toBeUndefined();

	expect(getAgentManagerRuntime()).toBe(finalManager);
});

test("contains runtime disconnect defects and reports unavailable runtimes as false", async () => {
	const { agentManager } = await import("../agents-manager");
	await expect(agentManager.disconnectAgent("agent-1")).resolves.toBe(false);

	const disconnectAgent = vi.fn().mockRejectedValue(new Error("runtime defect"));
	processWithAgentRuntime.__zerobyteAgentRuntime!.agentManager = fromAny({
		disconnectAgent,
		stop: Effect.void,
	});
	const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

	await expect(agentManager.disconnectAgent("agent-1")).resolves.toBe(false);
	expect(disconnectAgent).toHaveBeenCalledWith("agent-1");
	expect(warn).toHaveBeenCalledWith("Failed to disconnect agent agent-1");
});
