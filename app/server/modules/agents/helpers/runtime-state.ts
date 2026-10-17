import type { ChildProcess } from "node:child_process";
import { Semaphore, type Deferred, type Fiber } from "effect";
import type { ResticBackupOutputDto } from "@zerobyte/core/restic";
import type {
	BackupProgressPayload,
	RestoreCompletedPayload,
	RestoreProgressPayload,
} from "@zerobyte/contracts/agent-protocol";
import { getProcessSingleton } from "~/server/utils/process-singleton";
import type { AgentController } from "../controller/server";

export type BackupExecutionProgress = BackupProgressPayload["progress"];
export type BackupExecutionResult =
	| { status: "unavailable"; error: Error }
	| {
			status: "completed";
			exitCode: number;
			result: ResticBackupOutputDto | null;
			warningDetails: string | null;
	  }
	| { status: "failed"; error: string }
	| { status: "cancelled"; message?: string };
export type RestoreExecutionProgress = RestoreProgressPayload["progress"];
export type RestoreExecutionResult =
	| { status: "unavailable"; error: Error }
	| { status: "completed"; result: RestoreCompletedPayload["result"] }
	| { status: "failed"; error: string }
	| { status: "cancelled"; message?: string };

type ActiveBackupRun = {
	agentId: string;
	scheduleId: number;
	jobId: string;
	scheduleShortId: string;
	onProgress: (progress: BackupExecutionProgress) => void;
	resolve: (result: BackupExecutionResult) => void;
	cancellationRequested: boolean;
};

type ActiveRestoreRun = {
	agentId: string;
	restoreId: string;
	onProgress: (progress: RestoreExecutionProgress) => void;
	resolve: (result: RestoreExecutionResult) => void;
	cancellationRequested: boolean;
};

export type AgentRuntimeState = {
	controller: AgentController | null;
	lifecycleSemaphore: Semaphore.Semaphore;
	localAgent: ChildProcess | null;
	localAgentSupervisor: {
		fiber: Fiber.Fiber<void, Error>;
		readiness: { current: Deferred.Deferred<void, Error> };
	} | null;
	activeBackupsByScheduleId: Map<number, ActiveBackupRun>;
	activeBackupScheduleIdsByJobId: Map<string, number>;
	activeRestoresByRestoreId: Map<string, ActiveRestoreRun>;
};

export const createAgentRuntimeState = (): AgentRuntimeState => ({
	controller: null,
	lifecycleSemaphore: Semaphore.makeUnsafe(1),
	localAgent: null,
	localAgentSupervisor: null,
	activeBackupsByScheduleId: new Map(),
	activeBackupScheduleIdsByJobId: new Map(),
	activeRestoresByRestoreId: new Map(),
});

export type ProcessWithAgentRuntime = NodeJS.Process & {
	__zerobyteAgentRuntime?: AgentRuntimeState;
};

export const getAgentRuntimeState = () => getProcessSingleton("__zerobyteAgentRuntime", createAgentRuntimeState);
