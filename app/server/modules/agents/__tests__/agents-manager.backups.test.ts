import { afterEach, expect, test, vi } from "vitest";
import waitForExpect from "wait-for-expect";
import { fromPartial } from "@total-typescript/shoehorn";
import { agentManager } from "../agents-manager";
import type { AgentManagerRuntime } from "../controller/server";
import type { BackupRunPayload } from "@zerobyte/contracts/agent-protocol";

type ProcessWithAgentRuntime = NodeJS.Process & {
	__zerobyteAgentRuntime?: {
		agentManager: AgentManagerRuntime | null;
		localAgent: null;
		isStoppingLocalAgent: boolean;
		localAgentRestartTimeout: null;
	};
};

const setAgentRuntime = (agentManagerRuntime: Partial<AgentManagerRuntime> | null) => {
	(process as ProcessWithAgentRuntime).__zerobyteAgentRuntime = {
		agentManager: agentManagerRuntime ? fromPartial<AgentManagerRuntime>(agentManagerRuntime) : null,
		localAgent: null,
		isStoppingLocalAgent: false,
		localAgentRestartTimeout: null,
	};
};

afterEach(() => {
	delete (process as ProcessWithAgentRuntime).__zerobyteAgentRuntime;
	vi.restoreAllMocks();
});

test("cancelBackup resolves a running backup when the cancel command cannot be delivered", async () => {
	const sendBackup = vi.fn().mockResolvedValue(true);
	const cancelBackup = vi.fn().mockResolvedValue(false);
	setAgentRuntime({ sendBackup, cancelBackup });

	const resultPromise = agentManager.runBackup("local", {
		scheduleId: 42,
		payload: fromPartial<BackupRunPayload>({
			jobId: "job-1",
			scheduleId: "schedule-1",
		}),
		signal: new AbortController().signal,
		onProgress: vi.fn(),
	});

	await waitForExpect(() => {
		expect(sendBackup).toHaveBeenCalledTimes(1);
	});

	await expect(agentManager.cancelBackup("local", 42)).resolves.toBe(true);
	await expect(resultPromise).resolves.toEqual({ status: "cancelled" });
	expect(cancelBackup).toHaveBeenCalledWith("local", {
		jobId: "job-1",
		scheduleId: "schedule-1",
	});
});
