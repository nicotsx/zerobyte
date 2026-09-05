import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	startAgentController: vi.fn(async () => undefined),
	startLocalAgent: vi.fn(async () => undefined),
	stopAgentController: vi.fn(async () => undefined),
	stopLocalAgent: vi.fn(async () => undefined),
	prepareStartup: vi.fn(async () => undefined),
	activateScheduledJobs: vi.fn(async () => undefined),
	stopScheduler: vi.fn(async () => undefined),
}));

const runtimeProcess = process as typeof process & { __zerobyteApplicationLifecycleRuntime?: unknown };

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	delete runtimeProcess.__zerobyteApplicationLifecycleRuntime;
});

afterEach(() => {
	delete runtimeProcess.__zerobyteApplicationLifecycleRuntime;
});

vi.mock("../../../core/scheduler", () => ({ Scheduler: { stop: mocks.stopScheduler } }));

vi.mock("../../../db/db", () => ({ runDbMigrations: async () => undefined }));
vi.mock("../migrations", () => ({ runMigrations: async () => undefined }));
vi.mock("../../agents/agents.service", () => ({
	agentsService: { ensureLocalAgent: async () => undefined, markStaleRemoteAgentsOffline: async () => undefined },
}));
vi.mock("../../agents/agents-manager", () => mocks);
vi.mock("../startup", () => ({
	prepareStartup: mocks.prepareStartup,
	activateScheduledJobs: mocks.activateScheduledJobs,
}));

test("startup waits for the built-in agent before activating scheduled work", async () => {
	let resolveReady!: () => void;
	const ready = new Promise<undefined>((resolve) => {
		resolveReady = () => resolve(undefined);
	});
	mocks.startLocalAgent.mockReturnValueOnce(ready);
	const { bootstrapApplication } = await import("../bootstrap");
	const starting = bootstrapApplication();

	await vi.waitFor(() => expect(mocks.startLocalAgent).toHaveBeenCalledOnce());
	expect(mocks.startAgentController).toHaveBeenCalledOnce();
	expect(mocks.prepareStartup).toHaveBeenCalledOnce();
	expect(mocks.activateScheduledJobs).not.toHaveBeenCalled();

	resolveReady();
	await starting;
	expect(mocks.activateScheduledJobs).toHaveBeenCalledOnce();
});

test("failed local readiness stops runtime resources without activating scheduled work", async () => {
	mocks.startLocalAgent.mockRejectedValueOnce(new Error("Agent not ready"));
	const { bootstrapApplication } = await import("../bootstrap");

	await expect(bootstrapApplication()).rejects.toThrow("Agent not ready");
	expect(mocks.prepareStartup).toHaveBeenCalledOnce();
	expect(mocks.activateScheduledJobs).not.toHaveBeenCalled();
	expect(mocks.stopScheduler).toHaveBeenCalledOnce();
	expect(mocks.stopAgentController).toHaveBeenCalledOnce();
});

test("scheduler cleanup failure still stops the agent controller", async () => {
	mocks.startLocalAgent.mockRejectedValueOnce(new Error("Agent not ready"));
	mocks.stopScheduler.mockRejectedValueOnce(new Error("Scheduler cleanup failed"));
	const { bootstrapApplication } = await import("../bootstrap");

	await expect(bootstrapApplication()).rejects.toThrow("Scheduler cleanup failed");
	expect(mocks.activateScheduledJobs).not.toHaveBeenCalled();
	expect(mocks.stopAgentController).toHaveBeenCalledOnce();
});
