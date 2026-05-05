import { afterEach, expect, test, vi } from "vitest";
import { Effect } from "effect";
import { fromAny, fromPartial } from "@total-typescript/shoehorn";
import type { BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import type { AgentManagerEvent } from "../controller/server";
import type { ProcessWithAgentRuntime } from "../agents-manager";

const controllerMock = vi.hoisted(() => ({
	onEvent: null as null | ((event: AgentManagerEvent) => void),
	sendBackup: vi.fn(),
	cancelBackup: vi.fn(),
	stop: vi.fn(),
}));

vi.mock("../controller/server", async () => {
	const { Effect } = await import("effect");
	return {
		createAgentManagerRuntime: vi.fn((onEvent: (event: AgentManagerEvent) => void) => {
			controllerMock.onEvent = onEvent;
			return {
				start: Effect.void,
				stop: Effect.sync(controllerMock.stop),
				sendBackup: controllerMock.sendBackup,
				cancelBackup: controllerMock.cancelBackup,
			};
		}),
	};
});

const processWithAgentRuntime = process as ProcessWithAgentRuntime;

const resetAgentRuntime = () => {
	processWithAgentRuntime.__zerobyteAgentRuntime = {
		agentManager: null,
		localAgent: null,
		isStoppingLocalAgent: false,
		localAgentRestartTimeout: null,
		activeBackupsByScheduleId: new Map(),
		activeBackupScheduleIdsByJobId: new Map(),
	};
};

const backupPayload = fromPartial<BackupRunPayload>({
	jobId: "job-1",
	scheduleId: "schedule-1",
});

afterEach(() => {
	delete processWithAgentRuntime.__zerobyteAgentRuntime;
	controllerMock.onEvent = null;
	controllerMock.sendBackup.mockReset();
	controllerMock.cancelBackup.mockReset();
	controllerMock.stop.mockReset();
	vi.resetModules();
	vi.restoreAllMocks();
});

test("backup progress is delivered to the running backup callback", async () => {
	resetAgentRuntime();
	controllerMock.sendBackup.mockImplementation(() => Effect.succeed(true));
	const { agentManager, startAgentController, stopAgentController } = await import("../agents-manager");
	const onProgress = vi.fn();

	await startAgentController();
	const resultPromise = agentManager.runBackup("local", {
		scheduleId: 42,
		payload: backupPayload,
		signal: new AbortController().signal,
		onProgress,
	});

	controllerMock.onEvent?.({
		type: "backup.progress",
		agentId: "local",
		agentName: "Local Agent",
		payload: fromAny({ jobId: "job-1", scheduleId: "schedule-1", progress: { percentDone: 0.5 } }),
	});
	controllerMock.onEvent?.({
		type: "backup.completed",
		agentId: "local",
		agentName: "Local Agent",
		payload: { jobId: "job-1", scheduleId: "schedule-1", exitCode: 0, result: null },
	});

	await expect(resultPromise).resolves.toEqual({
		status: "completed",
		exitCode: 0,
		result: null,
		warningDetails: null,
	});
	expect(onProgress).toHaveBeenCalledWith({ percentDone: 0.5 });
	await stopAgentController();
});

test("backup failed and cancelled events resolve the matching running backup", async () => {
	resetAgentRuntime();
	controllerMock.sendBackup.mockImplementation(() => Effect.succeed(true));
	const { agentManager, startAgentController, stopAgentController } = await import("../agents-manager");

	await startAgentController();
	const failedPromise = agentManager.runBackup("local", {
		scheduleId: 42,
		payload: backupPayload,
		signal: new AbortController().signal,
		onProgress: vi.fn(),
	});
	controllerMock.onEvent?.({
		type: "backup.failed",
		agentId: "local",
		agentName: "Local Agent",
		payload: { jobId: "job-1", scheduleId: "schedule-1", error: "failed", errorDetails: "restic failed" },
	});
	await expect(failedPromise).resolves.toEqual({ status: "failed", error: "restic failed" });

	const cancelledPromise = agentManager.runBackup("local", {
		scheduleId: 43,
		payload: fromPartial<BackupRunPayload>({ jobId: "job-2", scheduleId: "schedule-2" }),
		signal: new AbortController().signal,
		onProgress: vi.fn(),
	});
	controllerMock.onEvent?.({
		type: "backup.cancelled",
		agentId: "local",
		agentName: "Local Agent",
		payload: { jobId: "job-2", scheduleId: "schedule-2", message: "cancelled remotely" },
	});
	await expect(cancelledPromise).resolves.toEqual({ status: "cancelled", message: "cancelled remotely" });
	await stopAgentController();
});

test("agent disconnect cancels only backups owned by that agent", async () => {
	resetAgentRuntime();
	controllerMock.sendBackup.mockImplementation(() => Effect.succeed(true));
	const { agentManager, startAgentController, stopAgentController } = await import("../agents-manager");

	await startAgentController();
	const localPromise = agentManager.runBackup("local", {
		scheduleId: 42,
		payload: backupPayload,
		signal: new AbortController().signal,
		onProgress: vi.fn(),
	});
	const remotePromise = agentManager.runBackup("remote", {
		scheduleId: 43,
		payload: fromPartial<BackupRunPayload>({ jobId: "job-2", scheduleId: "schedule-2" }),
		signal: new AbortController().signal,
		onProgress: vi.fn(),
	});

	controllerMock.onEvent?.({ type: "agent.disconnected", agentId: "local", agentName: "Local Agent" });
	controllerMock.onEvent?.({
		type: "backup.completed",
		agentId: "remote",
		agentName: "Remote Agent",
		payload: { jobId: "job-2", scheduleId: "schedule-2", exitCode: 0, result: null },
	});

	await expect(localPromise).resolves.toEqual({
		status: "cancelled",
		message: "The connection to the backup agent was lost. Restart the backup to ensure it completes.",
	});
	await expect(remotePromise).resolves.toEqual({
		status: "completed",
		exitCode: 0,
		result: null,
		warningDetails: null,
	});
	await stopAgentController();
});

test("runBackup returns unavailable and clears the active run when the command cannot be sent", async () => {
	resetAgentRuntime();
	controllerMock.sendBackup.mockImplementation(() => Effect.succeed(false));
	const { agentManager, startAgentController, stopAgentController } = await import("../agents-manager");

	await startAgentController();
	const result = await agentManager.runBackup("local", {
		scheduleId: 42,
		payload: backupPayload,
		signal: new AbortController().signal,
		onProgress: vi.fn(),
	});

	expect(result).toEqual({
		status: "unavailable",
		error: new Error("Failed to send backup command to agent local"),
	});
	await expect(agentManager.cancelBackup("local", 42)).resolves.toBe(false);
	await stopAgentController();
});

test("runBackup rejects before sending when the abort signal is already aborted", async () => {
	resetAgentRuntime();
	controllerMock.sendBackup.mockImplementation(() => Effect.succeed(true));
	const { agentManager, startAgentController, stopAgentController } = await import("../agents-manager");
	const abortController = new AbortController();
	abortController.abort(new Error("cancelled before send"));

	await startAgentController();
	await expect(
		agentManager.runBackup("local", {
			scheduleId: 42,
			payload: backupPayload,
			signal: abortController.signal,
			onProgress: vi.fn(),
		}),
	).rejects.toThrow("cancelled before send");
	expect(controllerMock.sendBackup).not.toHaveBeenCalled();
	await stopAgentController();
});

test("runBackup requests cancellation when the abort signal fires while sending", async () => {
	resetAgentRuntime();
	const abortController = new AbortController();
	controllerMock.sendBackup.mockImplementation(() =>
		Effect.sync(() => {
			abortController.abort();
			return true;
		}),
	);
	controllerMock.cancelBackup.mockImplementation(() => Effect.succeed(false));
	const { agentManager, startAgentController, stopAgentController } = await import("../agents-manager");

	await startAgentController();
	const result = await agentManager.runBackup("local", {
		scheduleId: 42,
		payload: backupPayload,
		signal: abortController.signal,
		onProgress: vi.fn(),
	});

	expect(result).toEqual({ status: "cancelled" });
	expect(controllerMock.cancelBackup).toHaveBeenCalledWith("local", { jobId: "job-1", scheduleId: "schedule-1" });
	await stopAgentController();
});
