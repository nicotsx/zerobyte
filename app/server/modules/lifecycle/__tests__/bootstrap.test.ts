import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ProcessWithApplicationLifecycleRuntime } from "../bootstrap-runtime";
import { fromPartial } from "@total-typescript/shoehorn";

const mocks = vi.hoisted(() => ({
	runDbMigrations: vi.fn(async () => undefined),
	runMigrations: vi.fn(async () => undefined),
	ensureLocalAgent: vi.fn(async () => undefined),
	markStaleRemoteAgentsOffline: vi.fn(async () => undefined),
	startAgentController: vi.fn(async () => undefined),
	startLocalAgent: vi.fn(async () => undefined),
	stopAgentController: vi.fn(async () => undefined),
	startup: vi.fn(async () => undefined),
	stopScheduler: vi.fn(async () => undefined),
	findVolumes: vi.fn(async () => [{ shortId: "local-volume", organizationId: "org-1", name: "Local volume" }]),
	unmountVolume: vi.fn(async () => ({ status: "unmounted", error: undefined })),
}));

vi.mock("../../../db/db", () => ({
	runDbMigrations: mocks.runDbMigrations,
	db: { query: { volumesTable: { findMany: mocks.findVolumes } } },
}));
vi.mock("../../../core/scheduler", () => ({ Scheduler: { stop: mocks.stopScheduler } }));
vi.mock("../../volumes/volume.service", () => ({ volumeService: { unmountVolume: mocks.unmountVolume } }));
vi.mock("../../agents/agents-manager", () => ({
	startAgentController: mocks.startAgentController,
	startLocalAgent: mocks.startLocalAgent,
	stopAgentController: mocks.stopAgentController,
}));
vi.mock("../../agents/agents.service", () => ({
	agentsService: {
		ensureLocalAgent: mocks.ensureLocalAgent,
		markStaleRemoteAgentsOffline: mocks.markStaleRemoteAgentsOffline,
	},
}));
vi.mock("../migrations", () => ({ runMigrations: mocks.runMigrations }));
vi.mock("../startup", () => ({ startup: mocks.startup }));

const runtimeProcess = process as ProcessWithApplicationLifecycleRuntime;

const deferred = <Value>() => {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
};

beforeEach(() => {
	vi.resetModules();
	delete runtimeProcess.__zerobyteApplicationLifecycleRuntime;
	for (const mock of Object.values(mocks)) {
		mock.mockReset();
	}
});

afterEach(() => {
	delete runtimeProcess.__zerobyteApplicationLifecycleRuntime;
	vi.restoreAllMocks();
});

test("serializes start stop start while the first migration is delayed", async () => {
	const migrationBarrier = deferred<undefined>();
	mocks.runDbMigrations.mockReturnValueOnce(migrationBarrier.promise);
	const { bootstrapApplication } = await import("../bootstrap");
	const { shutdown } = await import("../shutdown");

	const firstStart = bootstrapApplication();
	const stop = shutdown();
	const secondStart = bootstrapApplication();
	await vi.waitFor(() => expect(mocks.runDbMigrations).toHaveBeenCalledOnce());
	expect(mocks.stopAgentController).not.toHaveBeenCalled();

	migrationBarrier.resolve(undefined);
	await Promise.all([firstStart, stop, secondStart]);

	expect(mocks.runDbMigrations).toHaveBeenCalledTimes(2);
	expect(mocks.startAgentController).toHaveBeenCalledTimes(2);
	expect(mocks.startLocalAgent).toHaveBeenCalledTimes(2);
	expect(mocks.stopAgentController).toHaveBeenCalledOnce();
	expect(runtimeProcess.__zerobyteApplicationLifecycleRuntime?.status).toBe("running");
});

test("coalesces adjacent successful bootstraps", async () => {
	const { bootstrapApplication } = await import("../bootstrap");

	await Promise.all([bootstrapApplication(), bootstrapApplication(), bootstrapApplication()]);

	expect(mocks.runDbMigrations).toHaveBeenCalledOnce();
	expect(mocks.startAgentController).toHaveBeenCalledOnce();
	expect(mocks.startLocalAgent).toHaveBeenCalledOnce();
	expect(mocks.startup).toHaveBeenCalledOnce();
});

test("contains a failed bootstrap so a queued bootstrap can retry", async () => {
	const startupError = new Error("startup failed");
	mocks.startup.mockRejectedValueOnce(startupError);
	const { bootstrapApplication } = await import("../bootstrap");

	const failedStart = bootstrapApplication();
	const retry = bootstrapApplication();
	await expect(failedStart).rejects.toThrow("startup failed");
	await expect(retry).resolves.toBeUndefined();

	expect(mocks.runDbMigrations).toHaveBeenCalledTimes(2);
	expect(mocks.stopAgentController).toHaveBeenCalledOnce();
	expect(runtimeProcess.__zerobyteApplicationLifecycleRuntime?.status).toBe("running");
});

test("contains a failed stop so a queued bootstrap still restarts", async () => {
	const stopError = new Error("stop failed");
	mocks.stopAgentController.mockRejectedValueOnce(stopError);
	const { bootstrapApplication } = await import("../bootstrap");
	const { shutdown } = await import("../shutdown");
	await bootstrapApplication();

	const failedStop = shutdown();
	const restart = bootstrapApplication();
	await expect(failedStop).rejects.toThrow("stop failed");
	await expect(restart).resolves.toBeUndefined();

	expect(mocks.runDbMigrations).toHaveBeenCalledTimes(2);
	expect(mocks.startAgentController).toHaveBeenCalledTimes(2);
	expect(runtimeProcess.__zerobyteApplicationLifecycleRuntime?.status).toBe("running");
});

test("shares lifecycle state across a module reload", async () => {
	const migrationBarrier = deferred<undefined>();
	mocks.runDbMigrations.mockReturnValueOnce(migrationBarrier.promise);
	const firstModule = await import("../bootstrap");
	const firstStart = firstModule.bootstrapApplication();
	await vi.waitFor(() => expect(mocks.runDbMigrations).toHaveBeenCalledOnce());
	const runtimeBeforeReload = runtimeProcess.__zerobyteApplicationLifecycleRuntime;

	vi.resetModules();
	const reloadedModule = await import("../bootstrap");
	const reloadedStart = reloadedModule.bootstrapApplication();
	migrationBarrier.resolve(undefined);
	await Promise.all([firstStart, reloadedStart]);

	expect(runtimeProcess.__zerobyteApplicationLifecycleRuntime).toBe(runtimeBeforeReload);
	expect(mocks.runDbMigrations).toHaveBeenCalledOnce();
	expect(mocks.startAgentController).toHaveBeenCalledOnce();
	await (await import("../shutdown")).shutdown();
	expect(mocks.stopAgentController).toHaveBeenCalledOnce();
});

test("signal and Nitro close share cleanup and keep the agent alive until unmount finishes", async () => {
	const unmountBarrier = deferred<{ status: string; error: undefined }>();
	mocks.unmountVolume.mockReturnValueOnce(unmountBarrier.promise);
	const hook = vi.fn();
	const { default: bootstrapPlugin } = await import("../../../../nitro/plugins/bootstrap");
	await bootstrapPlugin(fromPartial({ hooks: { hook } }));
	const close = hook.mock.calls.find(([name]) => name === "close")?.[1] as () => Promise<void>;
	const { shutdown } = await import("../shutdown");

	const signalShutdown = shutdown();
	await vi.waitFor(() => expect(mocks.unmountVolume).toHaveBeenCalledOnce());
	const nitroShutdown = close();
	const settled = vi.fn();
	void nitroShutdown.then(settled);
	await new Promise((resolve) => setTimeout(resolve, 0));

	try {
		expect(mocks.stopAgentController).not.toHaveBeenCalled();
		expect(settled).not.toHaveBeenCalled();
	} finally {
		unmountBarrier.resolve({ status: "unmounted", error: undefined });
		await Promise.all([signalShutdown, nitroShutdown]);
	}

	await shutdown();
	await close();
	expect(mocks.stopScheduler).toHaveBeenCalledOnce();
	expect(mocks.unmountVolume).toHaveBeenCalledOnce();
	expect(mocks.stopAgentController).toHaveBeenCalledOnce();
	expect(mocks.stopScheduler.mock.invocationCallOrder[0]).toBeLessThan(
		mocks.unmountVolume.mock.invocationCallOrder[0]!,
	);
	expect(mocks.unmountVolume.mock.invocationCallOrder[0]).toBeLessThan(
		mocks.stopAgentController.mock.invocationCallOrder[0]!,
	);
});

test("Nitro close alone performs full cleanup and a new bootstrap resets shutdown", async () => {
	const hook = vi.fn();
	const { default: bootstrapPlugin } = await import("../../../../nitro/plugins/bootstrap");
	await bootstrapPlugin(fromPartial({ hooks: { hook } }));
	const close = hook.mock.calls.find(([name]) => name === "close")?.[1] as () => Promise<void>;

	await close();
	await close();
	expect(mocks.stopScheduler).toHaveBeenCalledOnce();
	expect(mocks.unmountVolume).toHaveBeenCalledOnce();
	expect(mocks.stopAgentController).toHaveBeenCalledOnce();

	const { bootstrapApplication } = await import("../bootstrap");
	const { shutdown } = await import("../shutdown");
	await bootstrapApplication();
	await shutdown();
	expect(mocks.stopScheduler).toHaveBeenCalledTimes(2);
	expect(mocks.unmountVolume).toHaveBeenCalledTimes(2);
	expect(mocks.stopAgentController).toHaveBeenCalledTimes(2);
});

test("shutdown waits for bootstrap and a queued restart waits for full cleanup", async () => {
	const migrationBarrier = deferred<undefined>();
	const unmountBarrier = deferred<{ status: string; error: undefined }>();
	mocks.runDbMigrations.mockReturnValueOnce(migrationBarrier.promise);
	mocks.unmountVolume.mockReturnValueOnce(unmountBarrier.promise);
	const { bootstrapApplication } = await import("../bootstrap");
	const { shutdown } = await import("../shutdown");
	const start = bootstrapApplication();
	const stop = shutdown();
	const restart = bootstrapApplication();
	await vi.waitFor(() => expect(mocks.runDbMigrations).toHaveBeenCalledOnce());

	try {
		expect(mocks.stopScheduler).not.toHaveBeenCalled();
		migrationBarrier.resolve(undefined);
		await vi.waitFor(() => expect(mocks.unmountVolume).toHaveBeenCalledOnce());
		expect(mocks.runDbMigrations).toHaveBeenCalledOnce();
		expect(mocks.stopAgentController).not.toHaveBeenCalled();
	} finally {
		migrationBarrier.resolve(undefined);
		unmountBarrier.resolve({ status: "unmounted", error: undefined });
		await Promise.all([start, stop, restart]);
	}

	expect(mocks.runDbMigrations).toHaveBeenCalledTimes(2);
	await shutdown();
	expect(mocks.stopScheduler).toHaveBeenCalledTimes(2);
});

test("overlapping shutdown callers across module reloads share a failed cleanup until bootstrap resets it", async () => {
	const unmountBarrier = deferred<{ status: string; error: undefined }>();
	const stopError = new Error("agent stop failed");
	mocks.unmountVolume.mockReturnValueOnce(unmountBarrier.promise);
	mocks.stopAgentController.mockRejectedValueOnce(stopError);
	const { bootstrapApplication } = await import("../bootstrap");
	await bootstrapApplication();
	const { shutdown } = await import("../shutdown");
	const stopping = shutdown();
	const firstResult = expect(stopping).rejects.toBe(stopError);
	await vi.waitFor(() => expect(mocks.unmountVolume).toHaveBeenCalledOnce());

	vi.resetModules();
	const reloadedShutdown = (await import("../shutdown")).shutdown;
	const secondResult = expect(reloadedShutdown()).rejects.toBe(stopError);
	unmountBarrier.resolve({ status: "unmounted", error: undefined });
	await Promise.all([firstResult, secondResult]);
	await expect(reloadedShutdown()).rejects.toBe(stopError);
	expect(mocks.stopScheduler).toHaveBeenCalledOnce();
	expect(mocks.unmountVolume).toHaveBeenCalledOnce();
	expect(mocks.stopAgentController).toHaveBeenCalledOnce();

	await (await import("../bootstrap")).bootstrapApplication();
	await reloadedShutdown();
	expect(mocks.stopScheduler).toHaveBeenCalledTimes(2);
	expect(mocks.stopAgentController).toHaveBeenCalledTimes(2);
});

test("scheduler failure still stops the agent and does not poison the next lifecycle", async () => {
	const { bootstrapApplication } = await import("../bootstrap");
	const { shutdown } = await import("../shutdown");
	await bootstrapApplication();
	const schedulerError = new Error("scheduler stop failed");
	mocks.stopScheduler.mockRejectedValueOnce(schedulerError);

	await expect(shutdown()).rejects.toBe(schedulerError);
	expect(mocks.unmountVolume).not.toHaveBeenCalled();
	expect(mocks.stopAgentController).toHaveBeenCalledOnce();

	await bootstrapApplication();
	await shutdown();
	expect(mocks.stopScheduler).toHaveBeenCalledTimes(2);
	expect(mocks.unmountVolume).toHaveBeenCalledOnce();
	expect(mocks.stopAgentController).toHaveBeenCalledTimes(2);
});

test("a failed volume unmount does not prevent remaining volumes or the agent from stopping", async () => {
	mocks.findVolumes.mockResolvedValueOnce([
		{ shortId: "first-volume", organizationId: "org-1", name: "First volume" },
		{ shortId: "second-volume", organizationId: "org-1", name: "Second volume" },
	]);
	mocks.unmountVolume.mockRejectedValueOnce(new Error("unmount failed"));
	const { shutdown } = await import("../shutdown");

	await shutdown();
	expect(mocks.unmountVolume).toHaveBeenNthCalledWith(1, "first-volume", { persistStatus: false });
	expect(mocks.unmountVolume).toHaveBeenNthCalledWith(2, "second-volume", { persistStatus: false });
	expect(mocks.stopAgentController).toHaveBeenCalledOnce();
});
