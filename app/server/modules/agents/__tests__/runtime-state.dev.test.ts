import { afterEach, expect, test, vi } from "vitest";
import type { ProcessWithAgentRuntime } from "../helpers/runtime-state.dev";

const runtimeProcess = process as ProcessWithAgentRuntime;
afterEach(() => {
	delete runtimeProcess.__zerobyteAgentRuntime;
	vi.resetModules();
});

test("the same live runtime and lifecycle queue survive a module reload", async () => {
	const firstModule = await import("../helpers/runtime-state.dev");
	const first = firstModule.getDevAgentRuntimeState();
	first.localAgentDesiredRunning = true;
	vi.resetModules();
	const secondModule = await import("../helpers/runtime-state.dev");
	const second = secondModule.getDevAgentRuntimeState();
	expect(second).toBe(first);
	expect(second.lifecycleTail).toBe(first.lifecycleTail);
	expect(second.localAgentDesiredRunning).toBe(true);
});
