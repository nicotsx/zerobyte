import { afterEach, describe, expect, test, vi } from "vitest";
import { Scheduler } from "../../../core/scheduler";
import * as backendModule from "../../backends/backend";
import type { VolumeBackend } from "../../backends/backend";
import * as bootstrapModule from "../bootstrap";
import { createTestVolume } from "~/test/helpers/volume";

const loadShutdownModule = async () => {
	const moduleUrl = new URL("../shutdown.ts", import.meta.url);
	moduleUrl.searchParams.set("test", crypto.randomUUID());
	return import(moduleUrl.href);
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("shutdown", () => {
	test("stops the agent runtime before unmounting mounted volumes", async () => {
		const events: string[] = [];
		const stopScheduler = vi.fn(async () => {
			events.push("scheduler.stop");
		});
		const stopApplicationRuntime = vi.fn(async () => {
			events.push("agents.stop");
		});
		const unmountVolume = vi.fn(async () => {
			events.push("backend.unmount");
			return { status: "unmounted" as const };
		});

		await createTestVolume({
			name: "Shutdown test volume",
			config: {
				backend: "directory",
				path: "/Applications",
			},
			status: "mounted",
		});

		vi.spyOn(Scheduler, "stop").mockImplementation(stopScheduler);
		vi.spyOn(bootstrapModule, "stopApplicationRuntime").mockImplementation(stopApplicationRuntime);
		vi.spyOn(backendModule, "createVolumeBackend").mockImplementation(
			() =>
				({
					mount: async () => ({ status: "mounted" as const }),
					unmount: unmountVolume,
					checkHealth: async () => ({ status: "mounted" as const }),
				}) satisfies VolumeBackend,
		);

		const { shutdown } = await loadShutdownModule();

		await shutdown();

		expect(events).toEqual(["scheduler.stop", "agents.stop", "backend.unmount"]);
	});
});
