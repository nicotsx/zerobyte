import { Effect } from "effect";
import { createAgentRuntimeState } from "../helpers/runtime-state";
import { afterEach, expect, test, vi } from "vitest";
import waitForExpect from "wait-for-expect";
import { fromAny, fromPartial } from "@total-typescript/shoehorn";
import { agentManager, type ProcessWithAgentRuntime } from "../agents-manager";
import type { AgentController } from "../controller/server";
import type {
	BackupRunPayload,
	FilesystemCommand,
	FilesystemCommandResponsePayload,
} from "@zerobyte/contracts/agent-protocol";

const setAgentController = (controller: Partial<AgentController> | null) => {
	(process as ProcessWithAgentRuntime).__zerobyteAgentRuntime = {
		...createAgentRuntimeState(),
		controller: fromAny(controller),
	};
};

afterEach(() => {
	delete (process as ProcessWithAgentRuntime).__zerobyteAgentRuntime;
	vi.restoreAllMocks();
});

test("cancelBackup retains a running backup when the cancel command cannot be delivered", async () => {
	const sendBackup = vi.fn(() => Effect.succeed(true));
	const cancelBackup = vi.fn(() => Effect.succeed(false));
	setAgentController({ sendBackup, cancelBackup });

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
	setAgentController({ runFilesystemCommand });

	const command = fromPartial<FilesystemCommand>({
		name: "filesystem.statfs",
		source: { rootId: "root", relativePath: "" },
	});

	await expect(agentManager.runFilesystemCommand("agent-1", "org-1", command)).resolves.toEqual({
		name: "filesystem.statfs",
		result: { total: 1, used: 0, free: 1 },
	});
	expect(runFilesystemCommand).toHaveBeenCalledWith("agent-1", "org-1", command);
});

test("runFilesystemCommand fails when the selected agent is unavailable", async () => {
	setAgentController(null);

	const command = fromPartial<FilesystemCommand>({
		name: "filesystem.statfs",
		source: { rootId: "root", relativePath: "" },
	});

	await expect(agentManager.runFilesystemCommand("agent-1", "org-1", command)).rejects.toThrow(
		"Failed to send filesystem command filesystem.statfs to agent agent-1",
	);
});
