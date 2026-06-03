import { afterEach, expect, test, vi } from "vitest";
import waitForExpect from "wait-for-expect";
import { fromAny, fromPartial } from "@total-typescript/shoehorn";
import { Effect } from "effect";
import { agentManager, type ProcessWithAgentRuntime } from "../agents-manager";
import type { AgentManagerRuntime } from "../controller/server";
import type { BackupRunPayload, VolumeCommand, VolumeCommandResponsePayload } from "@zerobyte/contracts/agent-protocol";

const setAgentRuntime = (agentManagerRuntime: Partial<AgentManagerRuntime> | null) => {
	(process as ProcessWithAgentRuntime).__zerobyteAgentRuntime = {
		agentManager: fromAny(agentManagerRuntime),
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
	const sendBackup = vi.fn(() => Effect.succeed(true));
	const cancelBackup = vi.fn(() => Effect.succeed(false));
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

test("runVolumeCommand sends the command to the selected agent", async () => {
	const runVolumeCommand = vi.fn(() =>
		Effect.succeed({
			commandId: "command-1",
			status: "success",
			command: { name: "volume.mount", result: { status: "mounted" } },
		} satisfies VolumeCommandResponsePayload),
	);
	setAgentRuntime({ runVolumeCommand });

	const command = fromPartial<VolumeCommand>({ name: "volume.mount", volume: { agentId: "agent-1" } });

	await expect(agentManager.runVolumeCommand("agent-1", command)).resolves.toEqual({
		name: "volume.mount",
		result: { status: "mounted" },
	});
	expect(runVolumeCommand).toHaveBeenCalledWith("agent-1", command);
});

test("runVolumeCommand fails when the selected agent is unavailable", async () => {
	setAgentRuntime(null);

	const command = fromPartial<VolumeCommand>({ name: "volume.mount", volume: { agentId: "agent-1" } });

	await expect(agentManager.runVolumeCommand("agent-1", command)).rejects.toThrow(
		"Volume agent agent-1 is not connected",
	);
});
