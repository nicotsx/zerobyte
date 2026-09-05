import type { ChildProcess } from "node:child_process";
import { Effect, type Deferred, type Fiber } from "effect";
import type { ResticBackupOutputDto } from "@zerobyte/core/restic";
import type {
	BackupProgressPayload,
	RestoreCompletedPayload,
	RestoreProgressPayload,
} from "@zerobyte/contracts/agent-protocol";
import type { AgentManagerRuntime } from "../controller/server";

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
	agentManager: AgentManagerRuntime | null;
	lifecycleSemaphore: Effect.Semaphore;
	localAgent: ChildProcess | null;
	localAgentSupervisor: {
		fiber: Fiber.RuntimeFiber<void, Error>;
		readiness: { current: Deferred.Deferred<void, Error> };
	} | null;
	activeBackupsByScheduleId: Map<number, ActiveBackupRun>;
	activeBackupScheduleIdsByJobId: Map<string, number>;
	activeRestoresByRestoreId: Map<string, ActiveRestoreRun>;
};

export const createAgentRuntimeState = (): AgentRuntimeState => ({
	agentManager: null,
	lifecycleSemaphore: Effect.unsafeMakeSemaphore(1),
	localAgent: null,
	localAgentSupervisor: null,
	activeBackupsByScheduleId: new Map(),
	activeBackupScheduleIdsByJobId: new Map(),
	activeRestoresByRestoreId: new Map(),
});
