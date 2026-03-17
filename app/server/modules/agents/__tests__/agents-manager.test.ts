import { afterEach, describe, expect, mock, test } from "bun:test";

const loadAgentsManagerModule = async () => {
	const moduleUrl = new URL("../agents-manager.ts", import.meta.url);
	moduleUrl.searchParams.set("test", crypto.randomUUID());
	return import(moduleUrl.href);
};

afterEach(() => {
	delete (globalThis as Record<string, unknown>).__agentManager;
	mock.restore();
});

describe("agents-manager module", () => {
	test("reuses the existing global agent manager without stopping it", async () => {
		const existingManager = {
			start: mock(() => {}),
			sendBackup: mock(() => false),
			cancelBackup: mock(() => false),
			setBackupEventHandlers: mock(() => {}),
			getBackupEventHandlers: mock(() => ({})),
			stop: mock(() => {}),
		};

		(globalThis as Record<string, unknown>).__agentManager = existingManager;

		const { agentManager } = await loadAgentsManagerModule();

		expect(agentManager).toBe(existingManager);
		expect(existingManager.stop).not.toHaveBeenCalled();
		expect((globalThis as Record<string, unknown>).__agentManager).toBe(existingManager);
	});
});
