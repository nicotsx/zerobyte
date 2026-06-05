import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Scheduler } from "../../../core/scheduler";
import { repoMutex } from "../../../core/repository-mutex";
import * as bootstrapModule from "../bootstrap";
import { agentManager } from "../../agents/agents-manager";
import { createTestVolume } from "~/test/helpers/volume";
import { config } from "~/server/core/config";
import { db } from "~/server/db/db";

const loadShutdownModule = async () => {
	const moduleUrl = new URL("../shutdown.ts", import.meta.url);
	moduleUrl.searchParams.set("test", crypto.randomUUID());
	return import(moduleUrl.href);
};

let originalEnableLocalAgent: boolean;

beforeEach(() => {
	originalEnableLocalAgent = config.flags.enableLocalAgent;
});

afterEach(() => {
	config.flags.enableLocalAgent = originalEnableLocalAgent;
	vi.restoreAllMocks();
});

describe("shutdown", () => {
	test("does not unmount agent-owned volumes during controller shutdown", async () => {
		const events: string[] = [];
		const stopScheduler = vi.fn(async () => {
			events.push("scheduler.stop");
		});
		const stopApplicationRuntime = vi.fn(async () => {
			events.push("agents.stop");
		});
		const shutdownRepoMutex = vi.fn(async () => {
			events.push("repo-mutex.shutdown");
		});
		const runVolumeCommand = vi.spyOn(agentManager, "runVolumeCommand");

		const volume = await createTestVolume({
			name: "Shutdown test volume",
			config: {
				backend: "directory",
				path: "/Applications",
			},
			status: "mounted",
			agentId: "agent-1",
		});

		vi.spyOn(Scheduler, "stop").mockImplementation(stopScheduler);
		vi.spyOn(repoMutex, "shutdown").mockImplementation(shutdownRepoMutex);
		vi.spyOn(bootstrapModule, "stopApplicationRuntime").mockImplementation(stopApplicationRuntime);

		const { shutdown } = await loadShutdownModule();

		await shutdown();

		expect(events).toEqual(["scheduler.stop", "repo-mutex.shutdown", "agents.stop"]);
		expect(runVolumeCommand).not.toHaveBeenCalled();
		const updated = await db.query.volumesTable.findFirst({ where: { id: volume.id } });
		expect(updated).toBeDefined();
		expect(updated!.status).toBe("mounted");
	});

	test("keeps mounted status while running the legacy controller-local fallback unmount on shutdown", async () => {
		config.flags.enableLocalAgent = false;
		const events: string[] = [];
		vi.spyOn(Scheduler, "stop").mockImplementation(async () => {
			events.push("scheduler.stop");
		});
		vi.spyOn(repoMutex, "shutdown").mockImplementation(async () => {
			events.push("repo-mutex.shutdown");
		});
		vi.spyOn(bootstrapModule, "stopApplicationRuntime").mockImplementation(async () => {
			events.push("agents.stop");
		});
		const runVolumeCommand = vi.spyOn(agentManager, "runVolumeCommand").mockImplementation(async () => {
			throw new Error("runVolumeCommand should not be called during fallback shutdown");
		});

		const volume = await createTestVolume({
			name: "Fallback shutdown test volume",
			config: { backend: "directory", path: "/Applications" },
			status: "mounted",
		});

		const { shutdown } = await loadShutdownModule();

		await shutdown();

		const updated = await db.query.volumesTable.findFirst({ where: { id: volume.id } });
		expect(events).toEqual(["scheduler.stop", "repo-mutex.shutdown", "agents.stop"]);
		expect(runVolumeCommand).not.toHaveBeenCalled();
		expect(updated).toBeDefined();
		expect(updated!.status).toBe("mounted");
	});
});
