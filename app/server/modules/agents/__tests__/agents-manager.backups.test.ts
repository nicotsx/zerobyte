import { createAgentRuntimeState } from "../helpers/runtime-state";
import { afterEach, expect, test, vi } from "vitest";
import waitForExpect from "wait-for-expect";
import { fromAny, fromPartial } from "@total-typescript/shoehorn";
import { Effect } from "effect";
import { agentManager, type ProcessWithAgentRuntime } from "../agents-manager";
import type { AgentManagerRuntime } from "../controller/server";
import type {
	BackupRunPayload,
	FilesystemCommand,
	FilesystemCommandResponsePayload,
} from "@zerobyte/contracts/agent-protocol";

const setAgentRuntime = (agentManagerRuntime: Partial<AgentManagerRuntime> | null) => {
	(process as ProcessWithAgentRuntime).__zerobyteAgentRuntime = {
		...createAgentRuntimeState(),
		agentManager: fromAny(agentManagerRuntime),
	};
};

afterEach(() => {
	delete (process as ProcessWithAgentRuntime).__zerobyteAgentRuntime;
	vi.restoreAllMocks();
});

test("cancelBackup retains a running backup when the cancel command cannot be delivered", async () => {
	const sendBackup = vi.fn(() => Effect.succeed(true));
	const cancelBackup = vi.fn(() => Effect.succeed(false));
	setAgentRuntime({ sendBackup, cancelBackup });

	void agentManager.runBackup("local", {
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

	await expect(agentManager.cancelBackup("local", 42)).resolves.toBe(false);
	expect(cancelBackup).toHaveBeenCalledWith("local", {
		jobId: "job-1",
		scheduleId: "schedule-1",
	});
});

test("runFilesystemCommand sends the command to the selected agent", async () => {
	const runFilesystemCommand = vi.fn(() =>
		Effect.succeed({
			commandId: "command-1",
			status: "success",
			command: { name: "filesystem.statfs", result: { total: 1, used: 0, free: 1 } },
		} satisfies FilesystemCommandResponsePayload),
	);
	setAgentRuntime({ runFilesystemCommand });

	const command = fromPartial<FilesystemCommand>({ name: "filesystem.statfs", path: "/tmp" });

	await expect(agentManager.runFilesystemCommand("agent-1", command)).resolves.toEqual({
		name: "filesystem.statfs",
		result: { total: 1, used: 0, free: 1 },
	});
	expect(runFilesystemCommand).toHaveBeenCalledWith("agent-1", command);
});

test("runFilesystemCommand fails when the selected agent is unavailable", async () => {
	setAgentRuntime(null);

	const command = fromPartial<FilesystemCommand>({ name: "filesystem.statfs", path: "/tmp" });

	await expect(agentManager.runFilesystemCommand("agent-1", command)).rejects.toThrow(
		"Filesystem agent agent-1 is not connected",
	);
});
