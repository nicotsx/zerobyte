import { Effect } from "effect";
import { fromPartial } from "@total-typescript/shoehorn";
import { expect, test, vi } from "vitest";
import waitForExpect from "wait-for-expect";
import { createSocket, getAgentsServiceMocks, startRuntime } from "./controller-runtime.test-utils";

const agentsServiceMocks = getAgentsServiceMocks();

const createRuntime = async () => {
	const { createAgentManagerRuntime } = await import("../controller/server");
	const onEvent = vi.fn();
	return createAgentManagerRuntime(onEvent);
};

const createDeferred = () => {
	let rejectPromise: ((error: unknown) => void) | undefined;
	let resolvePromise: (() => void) | undefined;
	const promise = new Promise<void>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return {
		promise,
		reject: (error: unknown) => rejectPromise?.(error),
		resolve: () => resolvePromise?.(),
	};
};

test("start, stop, start without awaiting publishes a fresh running generation", async () => {
	const firstServerStopped = createDeferred();
	const firstServerStop = vi.fn(() => firstServerStopped.promise);
	const secondServerStop = vi.fn(() => Promise.resolve());
	const serve = vi
		.spyOn(Bun, "serve")
		.mockReturnValueOnce(fromPartial({ port: 3001, stop: firstServerStop }))
		.mockReturnValueOnce(fromPartial({ port: 3002, stop: secondServerStop }));
	const runtime = await createRuntime();

	const firstStart = Effect.runPromise(runtime.start);
	const stop = Effect.runPromise(runtime.stop);
	const finalStart = Effect.runPromise(runtime.start);
	let finalStartSettled = false;
	void finalStart.finally(() => {
		finalStartSettled = true;
	});

	await firstStart;
	await waitForExpect(() => expect(firstServerStop).toHaveBeenCalledOnce());
	expect(finalStartSettled).toBe(false);
	expect(serve).toHaveBeenCalledOnce();

	firstServerStopped.resolve();
	await stop;
	await finalStart;

	expect(serve).toHaveBeenCalledTimes(2);
	expect(runtime.getControllerUrl()).toBe("ws://127.0.0.1:3002");
	expect(runtime.getLifecycle()).toBe("running");
	expect(secondServerStop).not.toHaveBeenCalled();

	await Effect.runPromise(runtime.stop);
	expect(secondServerStop).toHaveBeenCalledOnce();
	expect(runtime.getControllerUrl()).toBeNull();
	expect(runtime.getLifecycle()).toBe("stopped");
});

test("a failed start rejects its caller and a queued start publishes the next generation", async () => {
	const failedStart = new Error("listener failed to start");
	const serverStop = vi.fn(() => Promise.resolve());
	const serve = vi
		.spyOn(Bun, "serve")
		.mockImplementationOnce(() => {
			throw failedStart;
		})
		.mockReturnValueOnce(fromPartial({ port: 3002, stop: serverStop }));
	const runtime = await createRuntime();

	const firstStart = Effect.runPromise(runtime.start);
	const secondStart = Effect.runPromise(runtime.start);

	await expect(firstStart).rejects.toThrow("listener failed to start");
	await expect(secondStart).resolves.toBeUndefined();
	expect(serve).toHaveBeenCalledTimes(2);
	expect(runtime.getControllerUrl()).toBe("ws://127.0.0.1:3002");
	expect(runtime.getLifecycle()).toBe("running");

	await Effect.runPromise(runtime.stop);
	expect(serverStop).toHaveBeenCalledOnce();
	expect(runtime.getAgentCount()).toBe(0);
	expect(runtime.getRetirementCount()).toBe(0);
});

test("many interleaved lifecycle calls settle in invocation order without stranding state", async () => {
	const firstServerStopped = createDeferred();
	const secondServerStopped = createDeferred();
	const firstServerStop = vi.fn(() => firstServerStopped.promise);
	const secondServerStop = vi.fn(() => secondServerStopped.promise);
	const thirdServerStop = vi.fn(() => Promise.resolve());
	const serve = vi
		.spyOn(Bun, "serve")
		.mockReturnValueOnce(fromPartial({ port: 3001, stop: firstServerStop }))
		.mockReturnValueOnce(fromPartial({ port: 3002, stop: secondServerStop }))
		.mockReturnValueOnce(fromPartial({ port: 3003, stop: thirdServerStop }));
	const runtime = await createRuntime();

	const firstStart = Effect.runPromise(runtime.start);
	const duplicateFirstStart = Effect.runPromise(runtime.start);
	const firstStop = Effect.runPromise(runtime.stop);
	const duplicateFirstStop = Effect.runPromise(runtime.stop);
	const secondStart = Effect.runPromise(runtime.start);
	const duplicateSecondStart = Effect.runPromise(runtime.start);
	const secondStop = Effect.runPromise(runtime.stop);
	const finalStart = Effect.runPromise(runtime.start);
	const duplicateFinalStart = Effect.runPromise(runtime.start);
	let secondStartSettled = false;
	let finalStartSettled = false;
	void secondStart.then(() => {
		secondStartSettled = true;
	});
	void finalStart.then(() => {
		finalStartSettled = true;
	});

	await Promise.all([firstStart, duplicateFirstStart]);
	await waitForExpect(() => expect(firstServerStop).toHaveBeenCalledOnce());
	expect(secondStartSettled).toBe(false);
	expect(finalStartSettled).toBe(false);
	expect(serve).toHaveBeenCalledOnce();

	firstServerStopped.resolve();
	await Promise.all([firstStop, duplicateFirstStop]);
	await waitForExpect(() => expect(secondServerStop).toHaveBeenCalledOnce());
	expect(secondStartSettled).toBe(true);
	expect(finalStartSettled).toBe(false);
	expect(serve).toHaveBeenCalledTimes(2);
	expect(runtime.getControllerUrl()).toBe("ws://127.0.0.1:3002");

	secondServerStopped.resolve();
	await secondStop;
	await Promise.all([secondStart, duplicateSecondStart, finalStart, duplicateFinalStart]);
	expect(serve).toHaveBeenCalledTimes(3);
	expect(runtime.getControllerUrl()).toBe("ws://127.0.0.1:3003");
	expect(runtime.getLifecycle()).toBe("running");
	const finalSocket = createSocket("final-generation");
	const finalTransport = { send: finalSocket.send, close: finalSocket.close };
	await expect(runtime.openConnection(finalSocket.data, finalTransport)).resolves.toBe(true);

	await Effect.runPromise(runtime.stop);
	expect(thirdServerStop).toHaveBeenCalledOnce();
	expect(finalSocket.close).toHaveBeenCalledWith(1000, "controller_shutdown");
	expect(runtime.getControllerUrl()).toBeNull();
	expect(runtime.getLifecycle()).toBe("stopped");
	expect(runtime.getAgentCount()).toBe(0);
	expect(runtime.getRetirementCount()).toBe(0);
});

test("restart waits for the old generation to drain and concurrent starts create one listener", async () => {
	const oldServerStopped = createDeferred();
	const oldSessionCleaned = createDeferred();
	const oldServerStop = vi.fn(() => oldServerStopped.promise);
	const newServerStop = vi.fn(() => Promise.resolve());
	const serve = vi
		.spyOn(Bun, "serve")
		.mockReturnValueOnce(fromPartial({ port: 3001, stop: oldServerStop }))
		.mockReturnValueOnce(fromPartial({ port: 3002, stop: newServerStop }));
	agentsServiceMocks.markAgentOffline.mockReturnValueOnce(oldSessionCleaned.promise);
	const { runtime } = await startRuntime();
	const oldSocket = createSocket("old-generation");
	const oldTransport = { send: oldSocket.send, close: oldSocket.close };
	await runtime.openConnection(oldSocket.data, oldTransport);

	const oldStop = Effect.runPromise(runtime.stop);
	await waitForExpect(() => expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledOnce());
	const firstRestart = Effect.runPromise(runtime.start);
	const concurrentRestart = Effect.runPromise(runtime.start);
	const rejectedSocket = createSocket("during-old-drain", "remote-agent");
	const rejectedTransport = { send: rejectedSocket.send, close: rejectedSocket.close };
	const admittedDuringDrain = runtime.beginOpeningConnection(rejectedSocket.data, rejectedTransport);
	await new Promise((resolve) => setTimeout(resolve, 0));

	expect(admittedDuringDrain).toBe(false);
	expect(rejectedSocket.close).toHaveBeenCalledWith(1008, "controller_stopping");
	expect(serve).toHaveBeenCalledOnce();
	expect(runtime.getLifecycle()).toBe("stopping");

	oldServerStopped.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(serve).toHaveBeenCalledOnce();

	oldSessionCleaned.resolve();
	await oldStop;
	await Promise.all([firstRestart, concurrentRestart]);

	expect(serve).toHaveBeenCalledTimes(2);
	expect(runtime.getControllerUrl()).toBe("ws://127.0.0.1:3002");
	expect(runtime.getLifecycle()).toBe("running");
	expect(oldServerStop).toHaveBeenCalledOnce();
	expect(newServerStop).not.toHaveBeenCalled();
	const newSocket = createSocket("new-generation");
	const newTransport = { send: newSocket.send, close: newSocket.close };
	await expect(runtime.openConnection(newSocket.data, newTransport)).resolves.toBe(true);
	expect(newSocket.close).not.toHaveBeenCalled();

	await Effect.runPromise(runtime.stop);
	expect(newServerStop).toHaveBeenCalledOnce();
	expect(newSocket.close).toHaveBeenCalledWith(1000, "controller_shutdown");
});

test("stop requested during a queued restart closes the restarted generation", async () => {
	const oldServerStopped = createDeferred();
	const oldServerStop = vi.fn(() => oldServerStopped.promise);
	const newServerStop = vi.fn(() => Promise.resolve());
	const serve = vi
		.spyOn(Bun, "serve")
		.mockReturnValueOnce(fromPartial({ port: 3001, stop: oldServerStop }))
		.mockReturnValueOnce(fromPartial({ port: 3002, stop: newServerStop }));
	const { runtime } = await startRuntime();

	const oldStop = Effect.runPromise(runtime.stop);
	await waitForExpect(() => expect(oldServerStop).toHaveBeenCalledOnce());
	const restart = Effect.runPromise(runtime.start);
	const stopRestart = Effect.runPromise(runtime.stop);
	oldServerStopped.resolve();

	await Promise.all([oldStop, restart, stopRestart]);
	expect(serve).toHaveBeenCalledTimes(2);
	expect(newServerStop).toHaveBeenCalledOnce();
	expect(runtime.getControllerUrl()).toBeNull();
	expect(runtime.getLifecycle()).toBe("stopped");
});

test("a contained stop failure settles before a subsequent clean start", async () => {
	const failedServerStop = createDeferred();
	const firstServerStop = vi.fn(() => failedServerStop.promise);
	const secondServerStop = vi.fn(() => Promise.resolve());
	const serve = vi
		.spyOn(Bun, "serve")
		.mockReturnValueOnce(fromPartial({ port: 3001, stop: firstServerStop }))
		.mockReturnValueOnce(fromPartial({ port: 3002, stop: secondServerStop }));
	const { runtime } = await startRuntime();

	const failedStop = Effect.runPromise(runtime.stop);
	await waitForExpect(() => expect(firstServerStop).toHaveBeenCalledOnce());
	const restart = Effect.runPromise(runtime.start);
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(serve).toHaveBeenCalledOnce();

	failedServerStop.reject(new Error("old listener cleanup failed"));
	await expect(failedStop).resolves.toBeUndefined();
	await expect(restart).resolves.toBeUndefined();
	expect(serve).toHaveBeenCalledTimes(2);
	expect(runtime.getControllerUrl()).toBe("ws://127.0.0.1:3002");
	expect(runtime.getLifecycle()).toBe("running");

	await Effect.runPromise(runtime.stop);
	expect(secondServerStop).toHaveBeenCalledOnce();
});
