import { afterEach, expect, test, vi } from "vitest";
import { Effect } from "effect";
import { fromAny, fromPartial } from "@total-typescript/shoehorn";
import type { BackupRunPayload, RestoreRunPayload } from "@zerobyte/contracts/agent-protocol";
import type { AgentManagerEvent } from "../controller/server";
import type { ProcessWithAgentRuntime } from "../agents-manager";

const controllerMock = vi.hoisted(() => ({
	onEvent: null as null | ((event: AgentManagerEvent) => void),
	sendBackup: vi.fn(),
	cancelBackup: vi.fn(),
	sendRestore: vi.fn(),
	cancelRestore: vi.fn(),
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
				sendRestore: controllerMock.sendRestore,
				cancelRestore: controllerMock.cancelRestore,
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
		activeRestoresByRestoreId: new Map(),
	};
};

const backupPayload = fromPartial<BackupRunPayload>({
	jobId: "job-1",
	scheduleId: "schedule-1",
});
const restorePayload = fromPartial<RestoreRunPayload>({
	restoreId: "restore-1",
});

afterEach(() => {
	delete processWithAgentRuntime.__zerobyteAgentRuntime;
	controllerMock.onEvent = null;
	controllerMock.sendBackup.mockReset();
	controllerMock.cancelBackup.mockReset();
	controllerMock.sendRestore.mockReset();
	controllerMock.cancelRestore.mockReset();
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
		payload: fromAny({
			jobId: "job-1",
			scheduleId: "schedule-1",
			progress: { percentDone: 0.5 },
		}),
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

test("backup events from agents that do not own the active run are ignored", async () => {
	resetAgentRuntime();
	controllerMock.sendBackup.mockImplementation(() => Effect.succeed(true));
	const { agentManager, startAgentController, stopAgentController } = await import("../agents-manager");

	await startAgentController();
	const resultPromise = agentManager.runBackup("local", {
		scheduleId: 42,
		payload: backupPayload,
		signal: new AbortController().signal,
		onProgress: vi.fn(),
	});

	controllerMock.onEvent?.({
		type: "backup.completed",
		agentId: "remote",
		agentName: "Remote Agent",
		payload: { jobId: "job-1", scheduleId: "schedule-1", exitCode: 0, result: null },
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
		payload: {
			jobId: "job-1",
			scheduleId: "schedule-1",
			error: "failed",
			errorDetails: "restic failed",
		},
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
	await expect(cancelledPromise).resolves.toEqual({
		status: "cancelled",
		message: "cancelled remotely",
	});
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

	controllerMock.onEvent?.({
		type: "agent.disconnected",
		agentId: "local",
		agentName: "Local Agent",
	});
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
	expect(controllerMock.cancelBackup).toHaveBeenCalledWith("local", {
		jobId: "job-1",
		scheduleId: "schedule-1",
	});
	await stopAgentController();
});

test("startRestore requests cancellation when the abort signal fires after dispatch", async () => {
	resetAgentRuntime();
	controllerMock.sendRestore.mockImplementation(() => Effect.succeed(true));
	controllerMock.cancelRestore.mockImplementation(() => Effect.succeed(false));
	const { agentManager, startAgentController, stopAgentController } = await import("../agents-manager");
	const abortController = new AbortController();

	await startAgentController();
	const started = await agentManager.startRestore("local", {
		payload: restorePayload,
		signal: abortController.signal,
		onProgress: vi.fn(),
	});
	if (started.status !== "started") {
		throw new Error("Expected restore to start");
	}

	abortController.abort();

	await expect(started.result).resolves.toEqual({ status: "cancelled" });
	expect(controllerMock.cancelRestore).toHaveBeenCalledWith("local", { restoreId: "restore-1" });
	await stopAgentController();
});

test("restore events are delivered to the running restore callbacks", async () => {
	resetAgentRuntime();
	controllerMock.sendRestore.mockImplementation(() => Effect.succeed(true));
	const { agentManager, startAgentController, stopAgentController } = await import("../agents-manager");
	const onProgress = vi.fn();

	await startAgentController();
	const started = await agentManager.startRestore("local", {
		payload: restorePayload,
		signal: new AbortController().signal,
		onProgress,
	});
	if (started.status !== "started") {
		throw new Error("Expected restore to start");
	}

	controllerMock.onEvent?.({
		type: "restore.started",
		agentId: "local",
		agentName: "Local Agent",
		payload: {
			restoreId: "restore-1",
			organizationId: "org-1",
			repositoryId: "repo-1",
			snapshotId: "snapshot-1",
		},
	});
	controllerMock.onEvent?.({
		type: "restore.progress",
		agentId: "local",
		agentName: "Local Agent",
		payload: fromAny({ restoreId: "restore-1", progress: { percent_done: 0.5 } }),
	});
	controllerMock.onEvent?.({
		type: "restore.completed",
		agentId: "local",
		agentName: "Local Agent",
		payload: {
			restoreId: "restore-1",
			organizationId: "org-1",
			repositoryId: "repo-1",
			snapshotId: "snapshot-1",
			result: { message_type: "summary", files_restored: 2, files_skipped: 1 },
		},
	});

	await expect(started.result).resolves.toEqual({
		status: "completed",
		result: { message_type: "summary", files_restored: 2, files_skipped: 1 },
	});
	expect(onProgress).toHaveBeenCalledWith({ percent_done: 0.5 });
	await stopAgentController();
});

test("agent disconnect cancels only restores owned by that agent", async () => {
	resetAgentRuntime();
	controllerMock.sendRestore.mockImplementation(() => Effect.succeed(true));
	const { agentManager, startAgentController, stopAgentController } = await import("../agents-manager");

	await startAgentController();
	const localStarted = await agentManager.startRestore("local", {
		payload: restorePayload,
		signal: new AbortController().signal,
		onProgress: vi.fn(),
	});
	const remoteStarted = await agentManager.startRestore("remote", {
		payload: fromPartial<RestoreRunPayload>({ restoreId: "restore-2" }),
		signal: new AbortController().signal,
		onProgress: vi.fn(),
	});
	if (localStarted.status !== "started" || remoteStarted.status !== "started") {
		throw new Error("Expected restores to start");
	}

	controllerMock.onEvent?.({
		type: "agent.disconnected",
		agentId: "local",
		agentName: "Local Agent",
	});
	controllerMock.onEvent?.({
		type: "restore.completed",
		agentId: "remote",
		agentName: "Remote Agent",
		payload: {
			restoreId: "restore-2",
			organizationId: "org-1",
			repositoryId: "repo-1",
			snapshotId: "snapshot-1",
			result: { message_type: "summary", files_restored: 1, files_skipped: 0 },
		},
	});

	await expect(localStarted.result).resolves.toEqual({
		status: "cancelled",
		message: "The connection to the restore agent was lost. Restart the restore to ensure it completes.",
	});
	await expect(remoteStarted.result).resolves.toEqual({
		status: "completed",
		result: { message_type: "summary", files_restored: 1, files_skipped: 0 },
	});
	await stopAgentController();
});
