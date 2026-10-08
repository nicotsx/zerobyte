import { afterEach, expect, test, vi } from "vitest";
import type { ProcessWithAgentRuntime } from "../helpers/runtime-state.dev";

const runtimeProcess = process as ProcessWithAgentRuntime;
afterEach(() => {
	delete runtimeProcess.__zerobyteAgentRuntime;
	vi.resetModules();
});

test("the live runtime and active work survive a module reload", async () => {
	const firstModule = await import("../helpers/runtime-state.dev");
	const first = firstModule.getDevAgentRuntimeState();
	first.activeBackupScheduleIdsByJobId.set("job-1", 42);
	vi.resetModules();
	const secondModule = await import("../helpers/runtime-state.dev");
	const second = secondModule.getDevAgentRuntimeState();
	expect(second).toBe(first);
	expect(second.activeBackupScheduleIdsByJobId.get("job-1")).toBe(42);
});
