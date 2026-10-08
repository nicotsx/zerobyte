import { beforeEach, expect, test, vi } from "vitest";
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
vi.mock("../startup", () => ({ prepareStartup: mocks.startup, activateScheduledJobs: async () => undefined }));

beforeEach(() => {
	for (const mock of Object.values(mocks)) {
		mock.mockClear();
	}
});

test("the Nitro plugin bootstraps once and shuts down on close", async () => {
	const hook = vi.fn();
	const { default: bootstrapPlugin } = await import("../../../../nitro/plugins/bootstrap");

	await bootstrapPlugin(fromPartial({ hooks: { hook } }));

	expect(mocks.startAgentController).toHaveBeenCalledOnce();
	expect(mocks.startLocalAgent).toHaveBeenCalledOnce();

	const close = hook.mock.calls.find(([name]) => name === "close")?.[1] as () => Promise<void>;

	await close();

	expect(mocks.stopScheduler.mock.invocationCallOrder[0]).toBeLessThan(
		mocks.stopAgentController.mock.invocationCallOrder[0]!,
	);
	expect(mocks.stopAgentController.mock.invocationCallOrder[0]).toBeLessThan(
		mocks.unmountVolume.mock.invocationCallOrder[0]!,
	);
});

test("scheduler failure still stops the agent before failing shutdown", async () => {
	const schedulerError = new Error("scheduler stop failed");

	mocks.stopScheduler.mockRejectedValueOnce(schedulerError);

	const { shutdown } = await import("../shutdown");

	await expect(shutdown()).rejects.toBe(schedulerError);

	expect(mocks.stopAgentController).toHaveBeenCalledOnce();
	expect(mocks.unmountVolume).not.toHaveBeenCalled();
});

test("a failed volume unmount does not prevent the remaining volumes from unmounting", async () => {
	mocks.findVolumes.mockResolvedValueOnce([
		{ shortId: "first-volume", organizationId: "org-1", name: "First volume" },
		{ shortId: "second-volume", organizationId: "org-1", name: "Second volume" },
	]);
	mocks.unmountVolume.mockRejectedValueOnce(new Error("unmount failed"));

	const { shutdown } = await import("../shutdown");

	await shutdown();

	expect(mocks.unmountVolume).toHaveBeenNthCalledWith(1, "first-volume", { persistStatus: false });
	expect(mocks.unmountVolume).toHaveBeenNthCalledWith(2, "second-volume", { persistStatus: false });
});
