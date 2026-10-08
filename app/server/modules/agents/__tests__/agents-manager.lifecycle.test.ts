import { Effect } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fromAny } from "@total-typescript/shoehorn";
import type { ProcessWithAgentRuntime } from "../helpers/runtime-state";

const createAgentController = vi.hoisted(() => vi.fn());

vi.mock("../controller/server", () => ({ createAgentController }));

const processWithAgentRuntime = process as ProcessWithAgentRuntime;

const deferred = <Value>() => {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((resolvePromise) => {
		resolve = resolvePromise;
	});

	return { promise, resolve };
};

beforeEach(() => {
	vi.resetModules();
	createAgentController.mockReset();
	delete processWithAgentRuntime.__zerobyteAgentRuntime;
});

afterEach(() => {
	delete processWithAgentRuntime.__zerobyteAgentRuntime;
	vi.restoreAllMocks();
});

test("creates one controller and runs start and stop transitions in invocation order", async () => {
	const firstStart = deferred<void>();
	const transitions: string[] = [];
	let starts = 0;

	createAgentController.mockReturnValue(
		fromAny({
			start: Effect.promise(async () => {
				starts += 1;
				if (starts === 1) await firstStart.promise;
				transitions.push("start");
			}),
			stop: Effect.sync(() => transitions.push("stop")),
		}),
	);

	const { getAgentController, startAgentController, stopAgentController } = await import("../agents-manager");

	const start = startAgentController();
	const stop = stopAgentController();
	const restart = startAgentController();

	await vi.waitFor(() => expect(starts).toBe(1));
	expect(transitions).toEqual([]);

	firstStart.resolve();
	await Promise.all([start, stop, restart]);

	expect(transitions).toEqual(["start", "stop", "start"]);
	expect(createAgentController).toHaveBeenCalledOnce();
	expect(getAgentController()).toBe(getAgentController());
});

test("a failed start rejects its caller without blocking later transitions", async () => {
	const start = vi
		.fn()
		.mockReturnValueOnce(Effect.fail(new Error("start failed")))
		.mockReturnValue(Effect.void);

	createAgentController.mockReturnValue(
		fromAny({
			start: Effect.suspend(() => start()),
			stop: Effect.void,
		}),
	);

	const { startAgentController, stopAgentController } = await import("../agents-manager");

	await expect(startAgentController()).rejects.toThrow("start failed");
	await expect(startAgentController()).resolves.toBeUndefined();
	await expect(stopAgentController()).resolves.toBeUndefined();
});

test("the live runtime and active work survive a module reload", async () => {
	const firstModule = await import("../helpers/runtime-state");
	const first = firstModule.getAgentRuntimeState();

	first.activeBackupScheduleIdsByJobId.set("job-1", 42);

	vi.resetModules();

	const secondModule = await import("../helpers/runtime-state");
	const second = secondModule.getAgentRuntimeState();

	expect(second).toBe(first);
	expect(second.activeBackupScheduleIdsByJobId.get("job-1")).toBe(42);
});
